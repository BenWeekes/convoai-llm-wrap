// File: lib/common/endpoint-factory.ts
// Factory function to create standardized endpoint handlers

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { RequestWithJson, EndpointConfig } from '../types';
import { validateToken, logFullResponse, generateCallId, modelRequiresSpecialHandling, safeJSONParse } from './utils';
import { logCacheState, storeToolResponse } from './cache';
import { insertCachedToolResponses } from './message-processor';
import { handleModelRequest } from './model-handler';
import { simplifyMessagesForLlama, isFollowUpWithToolResponsesPresent } from './utils';

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
        stream = true, // boolean
        channel = 'ccc',
        userId = '111',
        appId = '',
        stream_options = {}
      } = body || {};

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
        apiKey: process.env.OPENAI_API_KEY,
        baseURL
      });

      // D) Create the system message with RAG data
      const systemMessage = {
        role: "system" as const,
        content: config.systemMessageTemplate(config.ragData)
      };
      
      // Process messages and insert cached tool responses if needed
      const processedMessages = insertCachedToolResponses(messages);
      
      // Check if this is a Llama/Trulience model and if we need to simplify the conversation
      let finalMessages;
      if ((typeof model === 'string' && 
          (model.toLowerCase().includes('llama') || model.toLowerCase().includes('trulience'))) &&
          isFollowUpWithToolResponsesPresent(processedMessages)) {
        
        // Use a simplified message history for Llama models on the second turn
        finalMessages = [systemMessage, ...simplifyMessagesForLlama(processedMessages)];
      } else {
        finalMessages = [systemMessage, ...processedMessages];
      }

      // E) Define request parameters
      const requestParams: any = {
        model,
        messages: finalMessages,
        stream: false
      };

      // Special handling for Llama models - keep tools but adjust parameters if needed
      if (typeof model === 'string' && 
          (model.toLowerCase().includes('llama') || model.toLowerCase().includes('trulience'))) {
        console.log(`Detected Llama/Trulience model: ${model}`);
        // We'll keep tools but handle any errors with the specific Llama retry logic
        requestParams.tools = config.tools;
        requestParams.tool_choice = "auto";
      } 
      // For other models that might need special handling
      else if (modelRequiresSpecialHandling(model)) {
        console.log(`Model ${model} may require special handling. Simplifying request...`);
        // For non-OpenAI models, we won't include tools
      } else {
        // For standard OpenAI models, include tools
        requestParams.tools = config.tools;
        requestParams.tool_choice = "auto";
      }

      console.info('stream', stream);
      console.dir(requestParams, { depth: null, colors: true });

      // F) Call the LLM
      if (stream) {
        try {
          // Set up streaming parameters
          const streamParams = { ...requestParams, stream: true };
          
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

          const streamBody = new ReadableStream({
            async start(controller) {
              try {
                for await (const part of streamingResponse) {
                  // Skip if controller is closed
                  if (controllerClosed) continue;
                  
                  const chunk = part.choices?.[0];
                  const delta = chunk?.delta;

                  // Merge any partial tool_calls
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
                  }

                  // Store everything for comprehensive response logging
                  completeResponse.push({
                    type: "initial_stream",
                    data: part
                  });

                  // Stream current chunk out
                  const dataString = `data: ${JSON.stringify(part)}\n\n`;
                  controller.enqueue(encoder.encode(dataString));

                  // When finish_reason is reached, process tool call only once
                  if (chunk?.finish_reason && !toolExecuted) {
                    toolExecuted = true;
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
                          
                          // Final streaming call with updated conversation
                          try {
                            const finalStreamParams: any = {
                              model,
                              messages: updatedMessages,
                              stream: true
                            };

                            // Add tools if appropriate for the model
                            if (!modelRequiresSpecialHandling(model)) {
                              finalStreamParams.tools = config.tools;
                              finalStreamParams.tool_choice = "auto";
                            }

                            const finalResponse = await handleModelRequest(openai, finalStreamParams);
                            
                            for await (const part2 of finalResponse) {
                              if (controllerClosed) break; // Skip if controller is closed
                              
                              // Store for comprehensive logging
                              completeResponse.push({
                                type: "final_stream",
                                data: part2
                              });
                              
                              const dataString2 = `data: ${JSON.stringify(part2)}\n\n`;
                              controller.enqueue(encoder.encode(dataString2));
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
        // For non-streaming, call with stream: false explicitly
        try {
          const nonStreamingResponse = await handleModelRequest(openai, requestParams);
          
          // Log the complete non-streaming response
          logFullResponse("NON-STREAM", nonStreamingResponse);
          
          return NextResponse.json(nonStreamingResponse, { status: 200 });
        } catch (error) {
          throw error; // Let the outer catch block handle it
        }
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
