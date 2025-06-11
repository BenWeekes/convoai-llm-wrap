// lib/common/endpoint-factory.ts
// Factory function to create standardized endpoint handlers
// Simplified to use only mode property (chat = RTM, voice/video = endpoints)

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { RequestWithJson, EndpointConfig } from '../types';
import { validateToken, logFullResponse, generateCallId, safeJSONParse, extractCommands, logLLMRequest, logLLMResponse, logStreamingChunk, logModeTransition } from './utils';
import { logCacheState, storeToolResponse } from './cache';
import { insertCachedToolResponses } from './message-processor';
import { handleModelRequest } from './model-handler';
import { simplifyMessagesForLlama, isFollowUpWithToolResponsesPresent } from './utils';
import { getOrCreateConversation, saveMessage } from './conversation-store';
import rtmClientManager, { RTMClientParams } from './rtm-client-manager';
import endpointChatManager from './rtm-chat-handler';

/**
 * Helper function to execute tool and handle final response
 */
async function executeToolCall(
  accumulatedToolCall: any,
  config: EndpointConfig,
  appId: string,
  userId: string,
  channel: string,
  finalMessages: any[],
  openai: OpenAI,
  model: string,
  simplifiedTools: boolean,
  completeResponse: any[],
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  rtmClient: any,
  enable_rtm: boolean,
  agent_rtm_channel: string,
  endpointMode?: string
): Promise<void> {
  console.log(`🚀 EXECUTING TOOL CALL - all conditions met`);
  
  const callName = accumulatedToolCall.function.name;
  const callArgsStr = accumulatedToolCall.function.arguments || "{}";
  const fn = config.toolMap[callName];
  
  console.log(`🔧 TOOL EXECUTION DEBUG:`);
  console.log(`- Tool name: ${callName}`);
  console.log(`- Args string: ${callArgsStr}`);
  console.log(`- Function exists: ${!!fn}`);
  console.log(`- Available tools:`, Object.keys(config.toolMap));
  
  if (!fn) {
    console.error(`❌ Unknown tool name: ${callName}`);
    return;
  }
  
  let parsedArgs: any = {};
  try {
    parsedArgs = safeJSONParse(callArgsStr);
    console.log(`- Parsed args:`, parsedArgs);
  } catch (err) {
    console.error("❌ Failed to parse tool call arguments:", err);
    return;
  }
  
  console.log(`🚀 Calling ${callName} for ${userId} in ${channel}`);
  
  try {
    // Execute the tool function
    const toolResult = await fn(appId, userId, channel, parsedArgs);
    console.log(`✅ Tool result for ${callName}:`, toolResult);

    // Store the tool response in the cache
    storeToolResponse(accumulatedToolCall.id, callName, toolResult);
    console.log(`💾 Cached tool response for call ID: ${accumulatedToolCall.id}`);
    
    // Store tool execution in the response log
    completeResponse.push({
      type: "tool_execution",
      tool_name: callName,
      arguments: parsedArgs,
      result: toolResult
    });
    
    // Create updated messages with tool call and result
    const updatedMessages = [
      ...finalMessages,
      {
        role: "assistant",
        content: "",
        tool_calls: [accumulatedToolCall]
      },
      {
        role: "tool",
        name: callName,
        content: toolResult,
        tool_call_id: accumulatedToolCall.id
      }
    ];
    
    // Make final streaming request
    const finalStreamParams: any = {
      model,
      messages: updatedMessages,
      stream: true
    };

    if (!simplifiedTools) {
      finalStreamParams.tools = config.tools;
      finalStreamParams.tool_choice = "auto";
    }

    console.log(`🔄 Making final stream request with ${updatedMessages.length} messages`);
    
    // LOG THE FINAL REQUEST AFTER TOOL EXECUTION
    logLLMRequest(finalStreamParams, {
      userId,
      appId,
      channel,
      endpointMode,
      conversationLength: updatedMessages.length
    });
    
    const finalResponse = await handleModelRequest(openai, finalStreamParams);
    
    // Stream the final response
    let finalChunkIndex = 0;
    for await (const part2 of finalResponse) {
      finalChunkIndex++;
      const chunk2 = part2.choices?.[0];
      const delta2 = chunk2?.delta;
      
      // LOG FINAL STREAMING CHUNKS
      logStreamingChunk(part2, {
        userId,
        chunkIndex: finalChunkIndex,
        hasToolCalls: !!delta2?.tool_calls,
        hasContent: !!delta2?.content,
        finishReason: chunk2?.finish_reason
      });
      
      if (delta2?.content) {
        // Process content and extract commands
        const modifiedPart2 = JSON.parse(JSON.stringify(part2));
        let modifiedContent2 = '';
        let currentContent2 = delta2.content;
        let inCommand = false;
        let commandBuffer = '';
        
        // Process character by character for command extraction
        for (let i = 0; i < currentContent2.length; i++) {
          const char = currentContent2[i];
          
          if (!inCommand && char === '<') {
            inCommand = true;
            commandBuffer = '<';
          } 
          else if (inCommand && char === '>') {
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
              rtmClientManager.updateLastActive(appId, userId, agent_rtm_channel);
            }
            
            commandBuffer = '';
          }
          else if (inCommand) {
            commandBuffer += char;
          }
          else {
            modifiedContent2 += char;
          }
        }
        
        // Update content and send if not empty
        modifiedPart2.choices[0].delta.content = modifiedContent2;
        
        if (modifiedContent2.length > 0) {
          completeResponse.push({
            type: "final_content_stream",
            data: modifiedPart2
          });
          
          const dataString2 = `data: ${JSON.stringify(modifiedPart2)}\n\n`;
          controller.enqueue(encoder.encode(dataString2));
        }
      }
    }
  } catch (toolError) {
    console.error(`❌ Error executing tool ${callName}:`, toolError);
    const errorResult = `Error executing ${callName}: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;
    storeToolResponse(accumulatedToolCall.id, callName, errorResult);
  }
}

/**
 * Helper function to end the stream properly
 */
function endStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  completeResponse: any[],
  logType: string,
  controllerClosed: { value: boolean }
): void {
  if (controllerClosed.value) return;
  
  const doneString = `data: [DONE]\n\n`;
  controller.enqueue(encoder.encode(doneString));
  completeResponse.push({
    type: "stream_end",
    marker: "[DONE]"
  });
  controllerClosed.value = true;
  controller.close();
  logFullResponse(logType, completeResponse);
}

/**
 * Creates an endpoint handler with consistent error handling and LLM interaction patterns
 * Simplified to use only mode property (chat = RTM, voice/video = endpoints)
 */
export function createEndpointHandler(config: EndpointConfig, endpointName?: string) {
  return async function endpointHandler(req: RequestWithJson) {
    try {
      // A) Validate token
      const authHeader = req.headers.get('Authorization') || '';
      if (!validateToken(authHeader, process.env.API_TOKEN || '')) {
        const errorResponse = { error: 'Invalid or missing token' };
        logFullResponse("ERROR-403", errorResponse);
        return NextResponse.json(errorResponse, { status: 403 });
      }

      // B) Parse request (handle both GET and POST)
      let body: any = {};
      if (req.method === 'POST') {
        try {
          body = await req.json();
        } catch (jsonError) {
          console.error('❌ Failed to parse JSON body:', jsonError);
          const errorResponse = { error: 'Invalid JSON in request body' };
          logFullResponse("ERROR-400", errorResponse);
          return NextResponse.json(errorResponse, { status: 400 });
        }
      } else {
        // GET request - no body expected, use empty object
        console.log('📝 GET request received - no body to parse');
        body = {};
      }

      const {
        messages: originalMessages = null,
        model = 'gpt-4o-mini',
        baseURL = 'https://api.openai.com/v1',
        apiKey = process.env.OPENAI_API_KEY,
        stream = true,
        channel = 'ccc',
        userId = '111',
        appId = '',
        simplifiedTools = false,
        stream_options = {},
        mode = null, // Communication mode parameter (kept for compatibility)
        // RTM parameters
        enable_rtm = false,
        agent_rtm_uid = '',
        agent_rtm_token = '',
        agent_rtm_channel = ''
      } = body;

      // C) Initialize RTM chat for this endpoint (only if endpointName is provided)
      if (endpointName) {
        try {
          await endpointChatManager.initializeEndpointChat(endpointName, config);
        } catch (chatInitError) {
          console.log(`[ENDPOINT] RTM chat initialization failed for ${endpointName}:`, chatInitError);
          // Continue without chat - this is not a fatal error
        }

        // D) Check for custom system message and update chat handler BEFORE processing
        if (originalMessages && Array.isArray(originalMessages) && originalMessages.length > 0 && 
            originalMessages[0].role === 'system' && appId) {
          console.log(`[ENDPOINT] Custom system message detected for ${endpointName}, updating chat handler`);
          endpointChatManager.updateSystemMessage(endpointName, appId, originalMessages[0].content);
        }
      }

      // Log communication mode configuration
      console.log(`[ENDPOINT] Communication mode config for ${endpointName}:`, {
        supportsChat: config.communicationModes?.supportsChat,
        endpointMode: config.communicationModes?.endpointMode
      });

      // Gather RTM parameters
      const rtmParams: RTMClientParams = {
        enable_rtm,
        agent_rtm_uid,
        agent_rtm_token,
        agent_rtm_channel,
        appId
      };

      // Initialize RTM if enabled
      const rtmClient = enable_rtm ? 
        await rtmClientManager.getOrCreateClient(rtmParams) : null;

      console.log('Request body:');
      console.dir(body, { depth: null, colors: true });
      
      logCacheState();
      
      // Skip validation for GET requests used for initialization
      if (req.method === 'GET') {
        console.log(`[ENDPOINT] GET request for ${endpointName || 'unknown'} - RTM chat initialization complete`);
        return NextResponse.json({ 
          message: 'Endpoint initialized successfully',
          rtm_chat_active: endpointName ? endpointChatManager.isEndpointChatActive(endpointName) : false,
          communication_modes: {
            supportsChat: config.communicationModes?.supportsChat || false,
            endpointMode: config.communicationModes?.endpointMode || null
          }
        });
      }
      
      if (!originalMessages || !Array.isArray(originalMessages)) {
        const errorResponse = { error: 'Missing or invalid "messages" in request body' };
        logFullResponse("ERROR-400", errorResponse);
        return NextResponse.json(errorResponse, { status: 400 });
      }
      if (!appId) {
        const errorResponse = { error: 'Missing "appId" in request body' };
        logFullResponse("ERROR-400", errorResponse);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // E) Create OpenAI client
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL
      });

      // F) Prepare messages - simplified system message handling based on mode
      let systemMessage: any;
      let requestMessages: any[];
      
      // Extract system message if present in request
      if (originalMessages.length > 0 && originalMessages[0].role === 'system') {
        systemMessage = {
          role: "system" as const,
          content: originalMessages[0].content
        };
        requestMessages = originalMessages.slice(1); // Remove system message from request messages
      } else {
        // Create default system message
        systemMessage = {
          role: "system" as const,
          content: config.systemMessageTemplate(config.ragData)
        };
        requestMessages = originalMessages;
      }
      
      // Add mode information to request messages - endpoints are always voice/video
      const endpointMode = config.communicationModes?.endpointMode;
      const supportsChat = config.communicationModes?.supportsChat || false;
      
      const processedMessages = endpointMode 
        ? requestMessages.map(msg => ({
            ...msg,
            mode: endpointMode // 'voice' or 'video' - endpoints never use 'chat'
          }))
        : requestMessages; // No mode if not configured
      
      // Get existing conversation to preserve history
      const existingConversation = await getOrCreateConversation(appId, userId);
      console.log(`[ENDPOINT] Found existing conversation with ${existingConversation.messages.length} messages`);
      
      // Process request messages and insert cached tool responses if needed
      const processedRequestMessages = insertCachedToolResponses(processedMessages);
      
      // Add current mode context only if modes are configured
      let currentModeContext = '';
      if (endpointMode || supportsChat) {
        const currentRequestMode = endpointMode; // This request is always the endpoint mode
        
        if (currentRequestMode === 'video') {
          currentModeContext = `

CURRENT COMMUNICATION MODE: VIDEO (user is on video call with you right now - they can see and hear you)
AVAILABLE MODES: ${supportsChat ? 'chat, video' : 'video'}`;
        } else if (currentRequestMode === 'voice') {
          currentModeContext = `

CURRENT COMMUNICATION MODE: VOICE (user is on voice call with you right now - they can hear you)
AVAILABLE MODES: ${supportsChat ? 'chat, voice' : 'voice'}`;
        } else if (supportsChat) {
          // No endpoint mode configured, but chat is supported
          currentModeContext = `

CURRENT COMMUNICATION MODE: UNKNOWN (check message "mode" field for context)
AVAILABLE MODES: chat`;
        }
      }
      
      // Update system message with current mode context (only if context was generated)
      if (currentModeContext) {
        systemMessage.content += currentModeContext;
      }
      
      // SIMPLIFIED SYSTEM MESSAGE MANAGEMENT - Let conversation store handle it based on mode
      console.log(`[ENDPOINT] Managing system message for ${userId} (endpoint mode: ${endpointMode || 'none'})`);
      
      // Save the system message - conversation store will manage duplicates based on mode
      await saveMessage(appId, userId, {
        role: 'system',
        content: systemMessage.content,
        mode: endpointMode // voice/video for endpoints
      });
      
      // Prepare final messages - get the managed conversation
      const managedConversation = await getOrCreateConversation(appId, userId);
      let finalMessages: any[];
      
      // The conversation store has already managed the system message, so we just append new messages
      const existingMessagesWithoutCurrent = managedConversation.messages.filter(msg => 
        !(processedRequestMessages.some(reqMsg => 
          reqMsg.role === msg.role && 
          reqMsg.content === msg.content && 
          Math.abs((msg.timestamp || 0) - Date.now()) < 5000 // Within 5 seconds
        ))
      );
      
      finalMessages = [...existingMessagesWithoutCurrent, ...processedRequestMessages];
      
      console.log(`[ENDPOINT] Final message count: ${finalMessages.length} (${existingMessagesWithoutCurrent.length} existing + ${processedRequestMessages.length} new)`);

      // Save user messages to conversation with mode information
      for (const message of processedRequestMessages) {
        if (message.role === 'user') {
          // LOG MODE TRANSITION
          logModeTransition({
            userId,
            appId,
            fromMode: 'unknown', // We could enhance this to track previous mode
            toMode: endpointMode || 'unspecified',
            channel,
            trigger: 'api_call'
          });

          await saveMessage(appId, userId, {
            role: 'user',
            content: message.content,
            mode: endpointMode // Add mode if specified (voice/video for endpoints)
          });
        }
      }

      // Check if simplification is needed based on message context
      if (isFollowUpWithToolResponsesPresent(processedRequestMessages)) {
        const existingWithoutSystem = existingConversation.messages.filter(msg => msg.role !== 'system');
        finalMessages = [systemMessage, ...simplifyMessagesForLlama([...existingWithoutSystem, ...processedRequestMessages])];
      }

      // Common request parameters
      const commonRequestParams: any = {
        model,
        stream: false // Initial request is non-streaming to detect tool calls
      };

      // Add tools if not using simplified tool handling
      if (!simplifiedTools) {
        commonRequestParams.tools = config.tools;
        commonRequestParams.tool_choice = "auto";
      }

      console.info('🔄 Request stream parameter:', stream);
      console.info('🔧 Common request params (stream=false for tool detection):');
      console.dir(commonRequestParams, { depth: null, colors: true });

      // G) Handle the request based on streaming preference
      if (stream) {
        try {
          // Set up streaming parameters
          const streamParams = { ...commonRequestParams, messages: finalMessages, stream: true };
          
          // LOG THE REQUEST TO LLM - STREAMING
          console.log(`\n🚀 ABOUT TO MAKE STREAMING LLM REQUEST`);
          logLLMRequest(streamParams, {
            userId,
            appId,
            channel,
            endpointMode,
            conversationLength: existingConversation.messages.length
          });

          // LOG RESPONSE CONTEXT
          logLLMResponse(null, {
            userId,
            appId,
            channel,
            endpointMode,
            requestType: 'streaming'
          });
          
          // Make the request with error handling
          const streamingResponse = await handleModelRequest(openai, streamParams);

          // H) For streaming, process async iterator of ChatCompletionChunk
          const encoder = new TextEncoder();

          // We'll merge partial tool call fragments into a single object.
          let accumulatedToolCall: any = null;
          let toolExecuted = false;
          let accumulatedContent = '';
          const controllerClosed = { value: false };
          
          // Track chunks sent to client for logging
          const completeResponse: any[] = [];
          
          const streamBody = new ReadableStream({
            async start(controller) {
              try {
                let inCommand = false;
                let commandBuffer = '';
                let chunkIndex = 0; // ADD CHUNK COUNTER
                
                for await (const part of streamingResponse) {
                  chunkIndex++; // INCREMENT CHUNK COUNTER
                  if (controllerClosed.value) continue;
                  
                  const chunk = part.choices?.[0];
                  const delta = chunk?.delta;

                  // LOG EACH STREAMING CHUNK
                  logStreamingChunk(part, {
                    userId,
                    chunkIndex,
                    hasToolCalls: !!delta?.tool_calls,
                    hasContent: !!delta?.content,
                    finishReason: chunk?.finish_reason
                  });

                  // Only log important chunks to reduce noise
                  if (chunk?.finish_reason || delta?.tool_calls) {
                    console.log(`📦 Processing chunk - finish_reason: ${chunk?.finish_reason}, has_tool_calls: ${!!delta?.tool_calls}, has_content: ${!!delta?.content}`);
                  }

                  // Handle tool calls accumulation
                  if (delta?.tool_calls) {
                    console.log(`🔧 TOOL CALL DETECTED:`, delta.tool_calls);
                    
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
                        // Merge fragments
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
                    
                    console.log(`🔧 ACCUMULATED TOOL CALL:`, accumulatedToolCall);
                    
                    // Store original part for logging
                    completeResponse.push({
                      type: "tool_stream",
                      data: part
                    });
                    
                    // Stream tool calls directly
                    const dataString = `data: ${JSON.stringify(part)}\n\n`;
                    controller.enqueue(encoder.encode(dataString));
                    continue;
                  }
                  
                  // Handle content with command extraction
                  if (delta?.content) {
                    // Accumulate content for conversation saving
                    accumulatedContent += delta.content;
                    
                    // Create a copy of the part that we can modify
                    const modifiedPart = JSON.parse(JSON.stringify(part));
                    let modifiedContent = '';
                    let currentContent = delta.content;
                    
                    // Process the content character by character
                    for (let i = 0; i < currentContent.length; i++) {
                      const char = currentContent[i];
                      
                      if (!inCommand && char === '<') {
                        inCommand = true;
                        commandBuffer = '<';
                      } 
                      else if (inCommand && char === '>') {
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
                          rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                        }
                        
                        commandBuffer = '';
                      }
                      else if (inCommand) {
                        commandBuffer += char;
                      }
                      else {
                        modifiedContent += char;
                      }
                    }
                    
                    // Update the content in the modified part
                    modifiedPart.choices[0].delta.content = modifiedContent;
                    
                    // Only send if there's actual content after modification
                    if (modifiedContent.length > 0) {
                      completeResponse.push({
                        type: "content_stream",
                        data: modifiedPart
                      });
                      
                      const dataString = `data: ${JSON.stringify(modifiedPart)}\n\n`;
                      controller.enqueue(encoder.encode(dataString));
                    } else {
                      completeResponse.push({
                        type: "filtered_chunk",
                        original: part
                      });
                    }
                  }

                  // Process finish_reason and check for accumulated tool calls
                  if (chunk?.finish_reason && !toolExecuted) {
                    console.log(`🏁 FINISH REASON DETECTED: ${chunk.finish_reason}`);
                    console.log(`🔧 Checking for accumulated tool call: ${!!accumulatedToolCall}`);
                    
                    if (accumulatedToolCall && accumulatedToolCall.function && accumulatedToolCall.function.name) {
                      console.log(`🎯 EXECUTING ACCUMULATED TOOL CALL`);
                      toolExecuted = true;
                      
                      await executeToolCall(
                        accumulatedToolCall,
                        config,
                        appId,
                        userId,
                        channel,
                        finalMessages,
                        openai,
                        model,
                        simplifiedTools,
                        completeResponse,
                        controller,
                        encoder,
                        rtmClient,
                        enable_rtm,
                        agent_rtm_channel,
                        endpointMode
                      );
                      
                      endStream(controller, encoder, completeResponse, "STREAM WITH TOOL", controllerClosed);
                      return;
                    } else {
                      console.log(`🤷 No accumulated tool call to execute`);
                      toolExecuted = true;
                      
                      // Save assistant response to conversation with mode
                      if (accumulatedContent.trim()) {
                        console.log(`💾 SAVING ASSISTANT RESPONSE WITH MODE: ${endpointMode || 'none'}`);
                        console.log(`💾 Response content length: ${accumulatedContent.trim().length} chars`);
                        console.log(`💾 Response preview: ${accumulatedContent.trim().substring(0, 100)}${accumulatedContent.length > 100 ? '...' : ''}`);
                        
                        await saveMessage(appId, userId, {
                          role: 'assistant',
                          content: accumulatedContent.trim(),
                          mode: endpointMode // Add mode if specified (voice/video for endpoints)
                        });
                      }
                      
                      // Process any pending commands
                      if (inCommand && commandBuffer.length > 0) {
                        if (rtmClient && enable_rtm && agent_rtm_channel) {
                          console.log(`[RTM] Extracted final command: ${commandBuffer}`);
                          await rtmClientManager.sendMessageToChannel(
                            rtmClient,
                            agent_rtm_channel,
                            commandBuffer + '>'
                          );
                          rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                        }
                      }
                      
                      endStream(controller, encoder, completeResponse, "STREAM WITHOUT TOOL", controllerClosed);
                      return;
                    }
                  }
                }
                
                // End of stream reached without finish_reason
                console.log(`🏁 END OF STREAM - no finish_reason detected`);
                
                // Save assistant response to conversation with mode
                if (accumulatedContent.trim()) {
                  console.log(`💾 SAVING FINAL ASSISTANT RESPONSE WITH MODE: ${endpointMode || 'none'}`);
                  console.log(`💾 Response content length: ${accumulatedContent.trim().length} chars`);
                  console.log(`💾 Response preview: ${accumulatedContent.trim().substring(0, 100)}${accumulatedContent.length > 100 ? '...' : ''}`);
                  
                  await saveMessage(appId, userId, {
                    role: 'assistant',
                    content: accumulatedContent.trim(),
                    mode: endpointMode // Add mode if specified (voice/video for endpoints)
                  });
                }
                
                // Process any remaining command
                if (inCommand && commandBuffer.length > 0) {
                  if (rtmClient && enable_rtm && agent_rtm_channel) {
                    console.log(`[RTM] Extracted final command: ${commandBuffer}`);
                    await rtmClientManager.sendMessageToChannel(
                      rtmClient,
                      agent_rtm_channel,
                      commandBuffer + '>'
                    );
                    rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
                  }
                }
                
                endStream(controller, encoder, completeResponse, "STREAM WITHOUT TOOL", controllerClosed);
                
              } catch (error) {
                console.error("❌ OpenAI streaming error:", error);
                if (!controllerClosed.value) {
                  try {
                    const errorMessage = error instanceof Error ? error.message : "Unknown streaming error";
                    completeResponse.push({
                      type: "error",
                      error: errorMessage
                    });
                    controller.error(error);
                    controllerClosed.value = true;
                    logFullResponse("STREAM ERROR", completeResponse);
                  } catch (controllerErr) {
                    console.error("❌ Error while sending error to controller:", controllerErr);
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
          console.error("❌ Stream setup error:", error);
          const errorMessage = error instanceof Error ? error.message : "Unknown streaming setup error";
          const errorResponse = { error: errorMessage };
          
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

          // LOG THE REQUEST TO LLM - NON-STREAMING
          logLLMRequest({
            ...commonRequestParams,
            messages: updatedMessages,
          }, {
            userId,
            appId,
            channel,
            endpointMode,
            conversationLength: existingConversation.messages.length
          });

          const passResponse = await handleModelRequest(openai, {
            ...commonRequestParams,
            messages: updatedMessages,
          });

          // LOG EACH PASS RESPONSE
          logLLMResponse(passResponse, {
            userId,
            appId, 
            channel,
            endpointMode,
            requestType: 'non-streaming'
          });

          finalResp = passResponse;

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
              console.error('[Non-Stream] ❌ Unknown tool name:', callName);
              console.log('[Non-Stream] Available tools:', Object.keys(config.toolMap));
              continue;
            }
            
            let parsedArgs = {};
            try {
              parsedArgs = safeJSONParse(tCall.function?.arguments || '{}');
            } catch (err) {
              console.error('[Non-Stream] ❌ Could not parse tool arguments:', err);
              continue;
            }

            console.log(`[Non-Stream] 🚀 Calling ${callName} for ${userId} in ${channel}`);

            try {
              const toolResult = await fn(appId, userId, channel, parsedArgs);
              console.log(`[Non-Stream] ✅ Tool result for ${callName}:`, toolResult);
              
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
            } catch (toolError) {
              console.error(`[Non-Stream] ❌ Error executing tool ${callName}:`, toolError);
              const errorResult = `Error executing ${callName}: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;
              
              // Add error result to messages
              updatedMessages.push({
                role: 'assistant',
                content: '',
                tool_calls: [tCall],
              });
              updatedMessages.push({
                role: 'tool',
                name: callName,
                content: errorResult,
                tool_call_id: tCall.id,
              });
            }
          }
        } // end multi-pass

        // finalResp has the last pass's text
        if (!finalResp) {
          return NextResponse.json({ error: 'No LLM response.' }, { status: 500 });
        }

        // Save assistant response to conversation with mode
        if (accumulatedText.trim()) {
          console.log(`💾 SAVING NON-STREAMING ASSISTANT RESPONSE WITH MODE: ${endpointMode || 'none'}`);
          console.log(`💾 Response content length: ${accumulatedText.trim().length} chars`);
          console.log(`💾 Response preview: ${accumulatedText.trim().substring(0, 100)}${accumulatedText.length > 100 ? '...' : ''}`);
          
          await saveMessage(appId, userId, {
            role: 'assistant',
            content: accumulatedText.trim(),
            mode: endpointMode // Add mode if specified (voice/video for endpoints)
          });
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
              inCommand = true;
              commandBuffer = '<';
            }
            else if (inCommand && char === '>') {
              commandBuffer += '>';
              commands.push(commandBuffer);
              inCommand = false;
              commandBuffer = '';
            }
            else if (inCommand) {
              commandBuffer += char;
            }
            else {
              cleanedText += char;
            }
          }
          
          // Process any remaining command buffer
          if (inCommand && commandBuffer.length > 0) {
            commands.push(commandBuffer + '>');
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
            
            rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
          }
        }

        // Log the complete non-streaming response
        logFullResponse("NON-STREAM", finalResp);
        
        return new Response(JSON.stringify(finalResp), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error: unknown) {
      console.error("❌ Chat Completions Error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const errorResponse = { error: errorMessage };
      
      logFullResponse("ERROR", errorResponse);
      
      return NextResponse.json(errorResponse, { status: 500 });
    }
  };
}