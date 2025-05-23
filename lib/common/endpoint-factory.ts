// File: lib/common/endpoint-factory.ts
// Factory function to create standardized endpoint handlers with multi-pass tool support

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { RequestWithJson, EndpointConfig } from '../types';
import { validateToken, logFullResponse, generateCallId, safeJSONParse, extractCommands } from './utils';
import { logCacheState, storeToolResponse } from './cache';
import { insertCachedToolResponses } from './message-processor';
import { handleModelRequest } from './model-handler';
import { simplifyMessagesForLlama, isFollowUpWithToolResponsesPresent } from './utils';
import rtmClientManager, { RTMClientParams } from './rtm-client-manager';

const DEFAULT_CHUNK_SIZE = 4096;

/**
 * Creates an endpoint handler with consistent error handling and LLM interaction patterns
 */
export function createEndpointHandler(config: EndpointConfig) {
  return async function endpointHandler(req: RequestWithJson) {
    try {
      // A) Validate token
      const authHeader = req.headers.get('Authorization') || '';
      if (!validateToken(authHeader, process.env.API_TOKEN || '')) {
        const errorResponse = { error: 'Invalid or missing token' };
        logFullResponse("ERROR-403", errorResponse);
        return NextResponse.json(errorResponse, { status: 403 });
      }

      // B) Parse request
      const body = await req.json();
      const {
        messages,
        model = 'gpt-4o-mini',
        baseURL = 'https://api.openai.com/v1',
        apiKey = process.env.OPENAI_API_KEY,
        stream = true, // boolean
        channel = 'ccc',
        userId = '111',
        appId = '',
        simplifiedTools = false, // New parameter to toggle simple tool handling
        stream_options = {},
        // RTM parameters
        enable_rtm = false,
        agent_rtm_uid = '',
        agent_rtm_token = '',
        agent_rtm_channel = ''
      } = body || {};

      // Gather RTM parameters, including appId from request
      const rtmParams: RTMClientParams = {
        enable_rtm,
        agent_rtm_uid,
        agent_rtm_token,
        agent_rtm_channel,
        appId    // Pass the appId from the request
      };

      // Initialize RTM if enabled
      const rtmClient = enable_rtm ? 
        await rtmClientManager.getOrCreateClient(rtmParams) : null;

      console.log('Request body:');
      console.dir(body, { depth: null, colors: true });
      
      // Log the current state of the cache
      logCacheState();
      
      if (!messages || !Array.isArray(messages)) {
        const errorResponse = { error: 'Missing or invalid "messages" in request body' };
        logFullResponse("ERROR-400", errorResponse);
        return NextResponse.json(errorResponse, { status: 400 });
      }
      if (!appId) {
        const errorResponse = { error: 'Missing "appId" in request body' };
        logFullResponse("ERROR-400", errorResponse);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // C) Create OpenAI client
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL
      });

      // D) Create the system message with RAG data
      const systemMessage = {
        role: "system" as const,
        content: config.systemMessageTemplate(config.ragData)
      };
      
      // Process messages and insert cached tool responses if needed
      const processedMessages = insertCachedToolResponses(messages);
      
      // Prepare final messages
      let finalMessages = [systemMessage, ...processedMessages];

      // Check if simplification is needed based on message context
      if (isFollowUpWithToolResponsesPresent(processedMessages)) {
        finalMessages = [systemMessage, ...simplifyMessagesForLlama(processedMessages)];
      }

      // Common request parameters
      const commonRequestParams: any = {
        model,
        stream: false
      };

      // Add tools if not using simplified tool handling
      if (!simplifiedTools) {
        commonRequestParams.tools = config.tools;
        commonRequestParams.tool_choice = "auto";
      }

      console.info('stream', stream);
      console.dir(commonRequestParams, { depth: null, colors: true });

      // F) Handle the request based on streaming preference
      if (stream) {
        try {
          // Set up streaming parameters
          const streamParams = { ...commonRequestParams, messages: finalMessages, stream: true };
          
          // Make the request with error handling
          const streamingResponse = await handleModelRequest(openai, streamParams);

          // G) For streaming, process async iterator of ChatCompletionChunk
          const encoder = new TextEncoder();

          // We'll merge partial tool call fragments into a single object.
          let accumulatedToolCall: any = null;
          let toolExecuted = false; // ensure we process the tool only once
          let controllerClosed = false; // Flag to track if controller is closed
          
          // Track chunks sent to client for logging
          const completeResponse: any[] = [];
          
          // Accumulate the full text response for logging
          let accumulatedText = '';

          const streamBody = new ReadableStream({
            async start(controller) {
              try {
                let inCommand = false;        // Flag to track if we're inside a command
                let commandBuffer = '';       // Buffer to collect command text
                
                for await (const part of streamingResponse) {
                  // Skip if controller is closed
                  if (controllerClosed) continue;
                  
                  const chunk = part.choices?.[0];
                  const delta = chunk?.delta;

                  // Handle tool calls accumulation
                  if (delta?.tool_calls) {
                    for (const tCall of delta.tool_calls) {
                      if (!accumulatedToolCall || (tCall.function?.name && accumulatedToolCall.function?.name && tCall.function.name !== accumulatedToolCall.function.name)) {
                        accumulatedToolCall = tCall;
                        if (!accumulatedToolCall.id) {
                          accumulatedToolCall.id = generateCallId();
                        }
                        if (typeof accumulatedToolCall.index !== "number") {
                          accumulatedToolCall.index = 0;
                        }
                        if (!accumulatedToolCall.type) {
                          accumulatedToolCall.type = "function";
                        }
                        if (!accumulatedToolCall.function) {
                          accumulatedToolCall.function = {};
                        }
                      } else {
                        // Otherwise merge fragments
                        if (tCall.function) {
                          if (tCall.function.name) {
                            accumulatedToolCall.function.name = tCall.function.name;
                          }
                          if (tCall.function.arguments) {
                            if (accumulatedToolCall.function.arguments) {
                              accumulatedToolCall.function.arguments += tCall.function.arguments;
                            } else {
                              accumulatedToolCall.function.arguments = tCall.function.arguments;
                            }
                          }
                        }
                      }
                    }
                    
                    // Store original part for logging
                    completeResponse.push({
                      type: "tool_stream",
                      data: part
                    });
                    
                    // Stream tool calls directly (no need to clean these)
                    const dataString = `data: ${JSON.stringify(part)}\n\n`;
                    controller.enqueue(encoder.encode(dataString));
                    continue;
                  }
                  
                  // Handle content with command extraction
                  if (delta?.content) {
                    // For logging only
                    accumulatedText += delta.content;
                    
                    // Create a copy of the part that we can modify
                    const modifiedPart = JSON.parse(JSON.stringify(part));
                    let modifiedContent = '';
                    let currentContent = delta.content;
                    
                    // Process the content character by character
                    for (let i = 0; i < currentContent.length; i++) {
                      const char = currentContent[i];
                      
                      if (!inCommand && char === '<') {
                        // Start of a command - switch to command mode
                        inCommand = true;
                        commandBuffer = '<';
                      } 
                      else if (inCommand && char === '>') {
                        // End of a command - process and reset
                        commandBuffer += '>';
                        inCommand = false;
                        
                        // Send command to RTM if enabled
                        if (rtmClient && enable_rtm && agent_rtm_channel) {
                          console.log(`[RTM] Extracted command: ${commandBuffer}`);
                          await rtmClientManager.sendMessageToChannel(
                            rtmClient,
                            agent_rtm_channel,
                            commandBuffer
                          );
                          
                          // Update RTM last active timestamp
                          rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                        }
                        
                        // Reset command buffer
                        commandBuffer = '';
                      }
                      else if (inCommand) {
                        // In the middle of a command - accumulate to command buffer
                        commandBuffer += char;
                      }
                      else {
                        // Normal content - add to modified content
                        modifiedContent += char;
                      }
                    }
                    
                    // Update the content in the modified part
                    modifiedPart.choices[0].delta.content = modifiedContent;
                    
                    // Only send if there's actual content after modification
                    if (modifiedContent.length > 0) {
                      // Store for comprehensive logging
                      completeResponse.push({
                        type: "content_stream",
                        data: modifiedPart
                      });
                      
                      // Stream modified chunk
                      const dataString = `data: ${JSON.stringify(modifiedPart)}\n\n`;
                      controller.enqueue(encoder.encode(dataString));
                    } else {
                      // Log that we filtered out a chunk
                      completeResponse.push({
                        type: "filtered_chunk",
                        original: part
                      });
                    }
                  }

                  // When finish_reason is reached, process tool call only once
                  if (chunk?.finish_reason && !toolExecuted) {
                    toolExecuted = true;
                    
                    // If we're in the middle of a command at the end, process it
                    if (inCommand && commandBuffer.length > 0) {
                      // Send incomplete command to RTM
                      if (rtmClient && enable_rtm && agent_rtm_channel) {
                        console.log(`[RTM] Extracted final command: ${commandBuffer}`);
                        await rtmClientManager.sendMessageToChannel(
                          rtmClient,
                          agent_rtm_channel,
                          commandBuffer + '>' // Add closing bracket for incomplete command
                        );
                        
                        // Update RTM last active timestamp
                        rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                      }
                    }
                    
                    if (accumulatedToolCall) {
                      // Ensure nested function object has a name
                      if (!accumulatedToolCall.function || !accumulatedToolCall.function.name) {
                        console.error("Accumulated tool call is missing function.name.");
                      } else {
                        const callName = accumulatedToolCall.function.name;
                        const callArgsStr = accumulatedToolCall.function.arguments || "{}";
                        const fn = config.toolMap[callName];
                        if (fn) {
                          let parsedArgs: any = {};
                          try {
                            parsedArgs = safeJSONParse(callArgsStr);
                          } catch (err) {
                            console.error("Failed to parse tool call arguments:", err);
                          }
                          console.log(
                            `Calling ${callName} for ${userId} in ${channel} with args:`,
                            JSON.stringify(parsedArgs)
                          );
                          
                          // Append an assistant message with valid tool_calls
                          const updatedMessages = [
                            ...finalMessages,
                            {
                              role: "assistant",
                              content: "",
                              tool_calls: [accumulatedToolCall]
                            }
                          ];
                          
                          // Execute the tool function
                          const toolResult = await fn(appId, userId, channel, parsedArgs);
                          console.log(`Tool result: ${toolResult}`);

                          // Store the tool response in the cache
                          storeToolResponse(accumulatedToolCall.id, callName, toolResult);
                          console.log(`Cached tool response for call ID: ${accumulatedToolCall.id}`);
                          
                          // Store tool execution in the response log
                          completeResponse.push({
                            type: "tool_execution",
                            tool_name: callName,
                            arguments: parsedArgs,
                            result: toolResult
                          });
                          
                          // Append a tool message referencing the same call id
                          updatedMessages.push({
                            role: "tool",
                            name: callName,
                            content: toolResult,
                            tool_call_id: accumulatedToolCall.id
                          });
                          
                          // Reset for final response
                          inCommand = false;
                          commandBuffer = '';
                          
                          // Final streaming call with updated conversation
                          try {
                            const finalStreamParams: any = {
                              model,
                              messages: updatedMessages,
                              stream: true
                            };

                            // Add tools if not using simplified tools
                            if (!simplifiedTools) {
                              finalStreamParams.tools = config.tools;
                              finalStreamParams.tool_choice = "auto";
                            }

                            const finalResponse = await handleModelRequest(openai, finalStreamParams);
                            
                            for await (const part2 of finalResponse) {
                              if (controllerClosed) break; // Skip if controller is closed
                              
                              const chunk2 = part2.choices?.[0];
                              const delta2 = chunk2?.delta;
                              
                              // If it's a tool call in the final response, send directly
                              if (delta2?.tool_calls) {
                                completeResponse.push({
                                  type: "final_tool_stream",
                                  data: part2
                                });
                                
                                const dataString2 = `data: ${JSON.stringify(part2)}\n\n`;
                                controller.enqueue(encoder.encode(dataString2));
                                continue;
                              }
                              
                              // If it's content in the final response, check for commands
                              if (delta2?.content) {
                                // Create a modified copy for the final response
                                const modifiedPart2 = JSON.parse(JSON.stringify(part2));
                                let modifiedContent2 = '';
                                let currentContent2 = delta2.content;
                                
                                // Process character by character
                                for (let i = 0; i < currentContent2.length; i++) {
                                  const char = currentContent2[i];
                                  
                                  if (!inCommand && char === '<') {
                                    // Start of a command
                                    inCommand = true;
                                    commandBuffer = '<';
                                  } 
                                  else if (inCommand && char === '>') {
                                    // End of a command
                                    commandBuffer += '>';
                                    inCommand = false;
                                    
                                    // Send command to RTM
                                    if (rtmClient && enable_rtm && agent_rtm_channel) {
                                      console.log(`[RTM] Extracted command from final response: ${commandBuffer}`);
                                      await rtmClientManager.sendMessageToChannel(
                                        rtmClient,
                                        agent_rtm_channel,
                                        commandBuffer
                                      );
                                      
                                      rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                                    }
                                    
                                    // Reset command buffer
                                    commandBuffer = '';
                                  }
                                  else if (inCommand) {
                                    // Accumulate command text
                                    commandBuffer += char;
                                  }
                                  else {
                                    // Normal content
                                    modifiedContent2 += char;
                                  }
                                }
                                
                                // Update content in the modified part
                                modifiedPart2.choices[0].delta.content = modifiedContent2;
                                
                                // Only send if there's content after modification
                                if (modifiedContent2.length > 0) {
                                  completeResponse.push({
                                    type: "final_content_stream",
                                    data: modifiedPart2
                                  });
                                  
                                  const dataString2 = `data: ${JSON.stringify(modifiedPart2)}\n\n`;
                                  controller.enqueue(encoder.encode(dataString2));
                                } else {
                                  completeResponse.push({
                                    type: "final_filtered_chunk",
                                    original: part2
                                  });
                                }
                              }
                              
                              // Check for finish reason in final response
                              if (chunk2?.finish_reason) {
                                // Process any remaining command
                                if (inCommand && commandBuffer.length > 0) {
                                  if (rtmClient && enable_rtm && agent_rtm_channel) {
                                    console.log(`[RTM] Extracted final incomplete command: ${commandBuffer}`);
                                    await rtmClientManager.sendMessageToChannel(
                                      rtmClient,
                                      agent_rtm_channel,
                                      commandBuffer + '>' // Add closing bracket for incomplete command
                                    );
                                    
                                    rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                                  }
                                }
                              }
                            }
                          } catch (streamErr) {
                            console.error("Error in final response stream:", streamErr);
                            completeResponse.push({
                              type: "error",
                              source: "final_stream",
                              error: streamErr instanceof Error ? streamErr.message : "Unknown error"
                            });
                          }
                        } else {
                          console.error("Unknown tool name:", callName);
                          completeResponse.push({
                            type: "error",
                            error: `Unknown tool name: ${callName}`
                          });
                        }
                      }
                    }
                    
                    // End SSE - make sure we only do this once
                    if (!controllerClosed) {
                      const doneString = `data: [DONE]\n\n`;
                      controller.enqueue(encoder.encode(doneString));
                      completeResponse.push({
                        type: "stream_end",
                        marker: "[DONE]"
                      });
                      controllerClosed = true;
                      controller.close();
                      
                      // Log the complete response
                      logFullResponse("STREAM WITH TOOL", completeResponse);
                    }
                    return;
                  }
                }
                
                // Process any remaining command at the end
                if (inCommand && commandBuffer.length > 0) {
                  // Send incomplete command to RTM
                  if (rtmClient && enable_rtm && agent_rtm_channel) {
                    console.log(`[RTM] Extracted final command: ${commandBuffer}`);
                    await rtmClientManager.sendMessageToChannel(
                      rtmClient,
                      agent_rtm_channel,
                      commandBuffer + '>' // Add closing bracket for incomplete command
                    );
                    
                    // Update RTM last active timestamp
                    rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                  }
                }
                
                // Normal end of stream if no tool call was processed
                if (!controllerClosed) {
                  const doneString = `data: [DONE]\n\n`;
                  controller.enqueue(encoder.encode(doneString));
                  completeResponse.push({
                    type: "stream_end",
                    marker: "[DONE]"
                  });
                  controllerClosed = true;
                  controller.close();
                  
                  // Log the complete response
                  logFullResponse("STREAM WITHOUT TOOL", completeResponse);
                }
              } catch (error) {
                console.error("OpenAI streaming error:", error);
                // Only try to send an error if the controller isn't closed
                if (!controllerClosed) {
                  try {
                    const errorMessage = error instanceof Error ? error.message : "Unknown streaming error";
                    const errorData = { error: errorMessage };
                    completeResponse.push({
                      type: "error",
                      error: errorMessage
                    });
                    controller.error(error);
                    controllerClosed = true;
                    
                    // Log the error response
                    logFullResponse("STREAM ERROR", completeResponse);
                  } catch (controllerErr) {
                    console.error("Error while sending error to controller:", controllerErr);
                  }
                }
              }
            }
          });

          const response = new Response(streamBody, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive"
            }
          });
          
          return response;
        } catch (error) {
          console.error("Stream setup error:", error);
          const errorMessage = error instanceof Error ? error.message : "Unknown streaming setup error";
          const errorResponse = { error: errorMessage };
          
          // Log the error response
          logFullResponse("STREAM SETUP ERROR", errorResponse);
          
          return NextResponse.json(errorResponse, { status: 500 });
        }
      } else {
        // =====================
        // NON-STREAMING WITH MULTI-PASS TOOL CALLING
        // =====================
        let updatedMessages = [...finalMessages];
        let passCount = 0;
        const maxPasses = 5;
        let finalResp: any = null;
        let accumulatedText = '';

        // Multi-pass logic
        while (passCount < maxPasses) {
          passCount++;
          console.log(`[Non-Stream] ---- PASS #${passCount} ----`);

          const passResponse = await handleModelRequest(openai, {
            ...commonRequestParams,
            messages: updatedMessages,
          });

          finalResp = passResponse;

          console.log('finalResp',finalResp);

          const firstChoice = passResponse?.choices?.[0];
          if (!firstChoice) {
            console.log('[Non-Stream] No choices returned; stopping.');
            break;
          }

          // Accumulate any text for command extraction
          if (firstChoice.message?.content) {
            accumulatedText = firstChoice.message.content;
          }

          const toolCalls = firstChoice.message?.tool_calls || [];
          if (!toolCalls.length) {
            // no tool calls => done
            break;
          }

          // If there are tool calls, execute them, append results
          for (const tCall of toolCalls) {
            const callName = tCall?.function?.name;
            if (!callName) continue;

            const fn = config.toolMap[callName];
            if (!fn) {
              console.error('[Non-Stream] Unknown tool name:', callName);
              continue;
            }
            let parsedArgs = {};
            try {
              parsedArgs = safeJSONParse(tCall.function?.arguments || '{}');
            } catch (err) {
              console.error('[Non-Stream] Could not parse tool arguments:', err);
            }

            const toolResult = await fn(appId, userId, channel, parsedArgs);
            storeToolResponse(tCall.id, callName, toolResult);

            // Add to messages
            updatedMessages.push({
              role: 'assistant',
              content: '',
              tool_calls: [tCall],
            });
            updatedMessages.push({
              role: 'tool',
              name: callName,
              content: toolResult,
              tool_call_id: tCall.id,
            });
          }
        } // end multi-pass

        // finalResp has the last pass's text
        if (!finalResp) {
          return NextResponse.json({ error: 'No LLM response.' }, { status: 500 });
        }

        // Extract commands from the final response text (if RTM is enabled)
        if (rtmClient && enable_rtm && agent_rtm_channel && accumulatedText) {
          let cleanedText = '';
          let inCommand = false;
          let commandBuffer = '';
          const commands = [];
          
          // Process character by character to extract commands
          for (let i = 0; i < accumulatedText.length; i++) {
            const char = accumulatedText[i];
            
            if (!inCommand && char === '<') {
              // Start of a command
              inCommand = true;
              commandBuffer = '<';
            }
            else if (inCommand && char === '>') {
              // End of a command
              commandBuffer += '>';
              commands.push(commandBuffer);
              inCommand = false;
              commandBuffer = '';
            }
            else if (inCommand) {
              // Add to command buffer
              commandBuffer += char;
            }
            else {
              // Normal text
              cleanedText += char;
            }
          }
          
          // Process any remaining command buffer
          if (inCommand && commandBuffer.length > 0) {
            commands.push(commandBuffer + '>'); // Add closing bracket for incomplete command
          }
          
          // Send commands to RTM
          if (commands.length > 0) {
            console.log(`[RTM] Extracted ${commands.length} commands from non-streaming response`);
            for (const cmd of commands) {
              await rtmClientManager.sendMessageToChannel(
                rtmClient,
                agent_rtm_channel,
                cmd
              );
            }
            
            // Update the response with cleaned text
            if (finalResp?.choices?.[0]?.message?.content) {
              finalResp.choices[0].message.content = cleanedText;
            }
            
            // Update RTM last active timestamp
            rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
          }
        }

        // Log the complete non-streaming response
        logFullResponse("NON-STREAM", finalResp);
        
        // Use direct Response instead of NextResponse.json() for more control
        return new Response(JSON.stringify(finalResp), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error: unknown) {
      console.error("Chat Completions Error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const errorResponse = { error: errorMessage };
      
      // Log the error response
      logFullResponse("ERROR", errorResponse);
      
      return NextResponse.json(errorResponse, { status: 500 });
    }
  };
}