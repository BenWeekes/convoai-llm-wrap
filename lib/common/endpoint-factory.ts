// lib/common/endpoint-factory.ts
// Factory function to create standardized endpoint handlers
// IMPROVED: Better request logging and reduced duplicate prefix logs
// UPDATED: Skip conversation history for pure API endpoints (supportsChat: false)

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { RequestWithJson, EndpointConfig } from '../types';
import { validateToken, logFullResponse, generateCallId, safeJSONParse, extractCommands, logLLMRequest, logLLMResponse, logStreamingChunk, logModeTransition } from './utils';
import { logCacheState, storeToolResponse } from './cache';
import { insertCachedToolResponses, cleanMessagesForLLM, cleanAssistantResponse } from './message-processor';
import { handleModelRequest } from './model-handler';
import { getOrCreateConversation, saveMessage } from './conversation-store';
import rtmClientManager, { RTMClientParams } from './rtm-client-manager';
import endpointChatManager from './rtm-chat-handler';
import { buildEnhancedSystemMessage } from './system-prompt-helpers';
import { endpointLogger as logger, toolLogger } from './logger';

/**
 * Helper function to determine if user ID prefixing is enabled for this endpoint
 */
function shouldPrependUserId(config: EndpointConfig): boolean {
  return config.communicationModes?.prependUserId === true;
}

/**
 * Helper function to determine if communication mode prefixing is enabled for this endpoint
 */
function shouldPrependCommunicationMode(config: EndpointConfig): boolean {
  return config.communicationModes?.prependCommunicationMode === true;
}

/**
 * Helper function to determine if we should skip conversation storage
 * Skip for pure API endpoints that don't support chat and have an endpoint mode
 */
function shouldSkipConversationStore(config: EndpointConfig): boolean {
  return config.communicationModes?.supportsChat === false && 
         config.communicationModes?.endpointMode !== undefined;
}

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
  endpointMode?: string,
  skipConversationStore?: boolean
): Promise<void> {
  logger.debug(`Executing tool call - all conditions met`);
  
  const callName = accumulatedToolCall.function.name;
  const callArgsStr = accumulatedToolCall.function.arguments || "{}";
  const fn = config.toolMap[callName];
  
  toolLogger.debug(`Tool execution`, {
    name: callName,
    argsString: callArgsStr,
    functionExists: !!fn,
    availableTools: Object.keys(config.toolMap)
  });
  
  if (!fn) {
    toolLogger.error(`Unknown tool name`, { toolName: callName });
    return;
  }
  
  let parsedArgs: any = {};
  try {
    parsedArgs = safeJSONParse(callArgsStr);
    toolLogger.trace(`Parsed tool args`, parsedArgs);
  } catch (err) {
    toolLogger.error("Failed to parse tool call arguments", err);
    return;
  }
  
  toolLogger.info(`Calling tool`, { name: callName, userId, channel });
  
  try {
    // Execute the tool function
    const toolResult = await fn(appId, userId, channel, parsedArgs);
    toolLogger.debug(`Tool result`, { name: callName, result: toolResult });

    // Store the tool response in the cache
    storeToolResponse(accumulatedToolCall.id, callName, toolResult);
    toolLogger.trace(`Cached tool response`, { callId: accumulatedToolCall.id.substring(0, 8) });
    
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
    
    // CLEAN MESSAGES FOR LLM COMPATIBILITY with prefixing support
    const shouldPrepend = shouldPrependUserId(config);
    const shouldPrependMode = shouldPrependCommunicationMode(config);
    const cleanedMessages = cleanMessagesForLLM(updatedMessages, {
      prependUserId: shouldPrepend,
      userId: shouldPrepend ? userId : undefined,
      prependCommunicationMode: shouldPrependMode,
      suppressLogs: true // Suppress logs for tool execution to reduce noise
    });
    
    // Make final streaming request
    const finalStreamParams: any = {
      model,
      messages: cleanedMessages,
      stream: true
    };

    if (!simplifiedTools) {
      finalStreamParams.tools = config.tools;
      finalStreamParams.tool_choice = "auto";
    }

    logger.debug(`Making final stream request after tool execution`, {
      messageCount: cleanedMessages.length
    });
    
    // LOG THE FINAL REQUEST AFTER TOOL EXECUTION
    logLLMRequest(finalStreamParams, {
      userId,
      appId,
      channel,
      endpointMode,
      conversationLength: cleanedMessages.length
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
              logger.trace(`Extracted command from final response`, { command: commandBuffer });
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
    toolLogger.error(`Error executing tool`, { name: callName, error: toolError });
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
          
          // IMPROVED REQUEST LOGGING
          logger.info(`[${endpointName || 'UNKNOWN'}] Request received`, {
            endpoint: endpointName,
            method: req.method,
            messagesCount: body.messages?.length || 0,
            model: body.model || 'default',
            stream: body.stream !== false,
            userId: body.userId,
            appId: body.appId,
            channel: body.channel,
            turn_id: body.turn_id,
            timestamp: body.timestamp,
            interruptable: body.interruptable,
            enable_rtm: body.enable_rtm || false,
            agent_rtm_channel: body.agent_rtm_channel,
            hasContext: !!body.context
          });
          
          // Log presence information if available
          if (body.context?.presence) {
            const presenceUsers = Object.keys(body.context.presence);
            logger.info(`[${endpointName}] Presence information`, {
              totalUsers: presenceUsers.length,
              users: presenceUsers,
              presenceDetails: JSON.stringify(body.context.presence, null, 2)
            });
          }
          
          // Log first 3 and last 3 messages for context
          if (body.messages && Array.isArray(body.messages)) {
            const msgCount = body.messages.length;
            const messageSummary: any[] = [];
            
            // First 3 messages
            for (let i = 0; i < Math.min(3, msgCount); i++) {
              const msg = body.messages[i];
              messageSummary.push({
                index: i,
                role: msg.role,
                contentPreview: msg.content ? msg.content.substring(0, 100) : '[no content]',
                metadata: msg.metadata,
                turn_id: msg.turn_id,
                timestamp: msg.timestamp
              });
            }
            
            // Add ellipsis if more than 6 messages
            if (msgCount > 6) {
              messageSummary.push({ note: `... ${msgCount - 6} more messages ...` });
            }
            
            // Last 3 messages (if different from first 3)
            if (msgCount > 3) {
              for (let i = Math.max(3, msgCount - 3); i < msgCount; i++) {
                const msg = body.messages[i];
                messageSummary.push({
                  index: i,
                  role: msg.role,
                  contentPreview: msg.content ? msg.content.substring(0, 100) : '[no content]',
                  metadata: msg.metadata,
                  turn_id: msg.turn_id,
                  timestamp: msg.timestamp
                });
              }
            }
            
            logger.debug(`[${endpointName}] Message summary`, messageSummary);
          }
          
        } catch (jsonError) {
          logger.error('Failed to parse JSON body', jsonError);
          const errorResponse = { error: 'Invalid JSON in request body' };
          logFullResponse("ERROR-400", errorResponse);
          return NextResponse.json(errorResponse, { status: 400 });
        }
      } else {
        // GET request - no body expected, use empty object
        logger.debug('GET request received - no body to parse');
        body = {};
      }

      const {
        messages: originalMessages = null,
        model = 'gpt-4o-mini',
        baseURL = 'https://api.openai.com/v1',
        apiKey = process.env.OPENAI_API_KEY,
        stream = true,
        channel = 'default',
        userId = '111',
        appId = '',
        simplifiedTools = false,
        stream_options = {},
        mode = null,
        // RTM parameters
        enable_rtm = false,
        agent_rtm_uid = '',
        agent_rtm_token = '',
        agent_rtm_channel = '',
        // Context parameters
        context = null
      } = body;

      // Check if we should skip conversation storage for this endpoint
      const skipConversationStore = shouldSkipConversationStore(config);
      
      if (skipConversationStore) {
        logger.info(`[${endpointName}] Skipping conversation store for pure API endpoint`);
      }

      // Check prefixing configuration
      const shouldPrepend = shouldPrependUserId(config);
      const shouldPrependMode = shouldPrependCommunicationMode(config);
      
      if (shouldPrepend || shouldPrependMode) {
        logger.info(`[${endpointName || 'UNKNOWN'}] Prefixing configuration`, {
          endpoint: endpointName,
          userId: shouldPrepend ? userId : 'disabled',
          communicationMode: shouldPrependMode ? 'enabled' : 'disabled'
        });
      }

      // C) Initialize RTM chat for this endpoint (only if endpointName is provided AND chat is supported)
      if (endpointName) {
        const supportsChat = config.communicationModes?.supportsChat || false;
        
        if (supportsChat) {
          try {
            await endpointChatManager.initializeEndpointChat(endpointName, config);
          } catch (chatInitError) {
            logger.warn(`[${endpointName}] RTM chat initialization failed`, { error: chatInitError });
          }

          // D) Check for custom system message and update chat handler BEFORE processing
          if (originalMessages && Array.isArray(originalMessages) && originalMessages.length > 0 && 
              originalMessages[0].role === 'system' && appId) {
            logger.debug(`[${endpointName}] Custom system message detected, updating chat handler`);
            endpointChatManager.updateSystemMessage(endpointName, appId, originalMessages[0].content);
          }
        } else {
          logger.debug(`[${endpointName}] RTM chat not initialized (endpoint doesn't support chat mode)`);
        }
      }

      // Log communication mode configuration
      logger.debug(`[${endpointName || 'UNKNOWN'}] Communication mode config`, {
        supportsChat: config.communicationModes?.supportsChat || false,
        endpointMode: config.communicationModes?.endpointMode || null,
        prependUserId: shouldPrepend,
        prependCommunicationMode: shouldPrependMode,
        channel,
        skipConversationStore
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

      logger.trace('Request details', {
        method: req.method,
        hasMessages: !!originalMessages,
        appId,
        userId,
        channel
      });
      
      logCacheState();
      
      // Skip validation for GET requests used for initialization
      if (req.method === 'GET') {
        logger.info(`[${endpointName || 'UNKNOWN'}] GET request for endpoint initialization`, {
          endpoint: endpointName || 'unknown',
          rtmChatActive: endpointName ? endpointChatManager.isEndpointChatActive(endpointName) : false
        });
        return NextResponse.json({ 
          message: 'Endpoint initialized successfully',
          endpoint: endpointName || 'unknown',
          rtm_chat_active: endpointName ? endpointChatManager.isEndpointChatActive(endpointName) : false,
          communication_modes: {
            supportsChat: config.communicationModes?.supportsChat || false,
            endpointMode: config.communicationModes?.endpointMode || null
          },
          prepend_user_id: shouldPrepend,
          prepend_communication_mode: shouldPrependMode,
          channel_based_history: !skipConversationStore,
          skip_conversation_store: skipConversationStore
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

      // F) Prepare messages with enhanced system message generation
      let systemMessage: any;
      let requestMessages: any[];
      
      // Extract system message if present in request
      if (originalMessages.length > 0 && originalMessages[0].role === 'system') {
        // Use the provided system message as base and enhance it
        const baseSystemMessage = originalMessages[0].content;
        const enhancedContent = buildEnhancedSystemMessage(baseSystemMessage, config);
        
        systemMessage = {
          role: "system" as const,
          content: enhancedContent
        };
        requestMessages = originalMessages.slice(1);
        
        logger.debug(`Enhanced custom system message with automatic context`);
      } else {
        // Create enhanced system message from endpoint template
        const baseSystemMessage = config.systemMessageTemplate(config.ragData);
        const enhancedContent = buildEnhancedSystemMessage(baseSystemMessage, config);
        
        systemMessage = {
          role: "system" as const,
          content: enhancedContent
        };
        requestMessages = originalMessages;
        
        logger.debug(`Generated enhanced system message from template with automatic context`);
      }
      
      // Add mode information to request messages
      const endpointMode = config.communicationModes?.endpointMode;
      const processedMessages = endpointMode 
        ? requestMessages.map(msg => ({
            ...msg,
            mode: endpointMode
          }))
        : requestMessages;
      
      // Process request messages and insert cached tool responses if needed
      const processedRequestMessages = insertCachedToolResponses(processedMessages);
      
      // Prepare final messages based on whether we're using conversation store
      let finalMessages: any[];
      let existingConversationLength = 0;
      
      if (!skipConversationStore) {
        // ORIGINAL BEHAVIOR: Use conversation store for endpoints that support chat
        
        // Get existing conversation to preserve history
        const existingConversation = await getOrCreateConversation(appId, userId, channel);
        existingConversationLength = existingConversation.messages.length;
        
        logger.debug(`Found existing conversation`, {
          userId,
          channel,
          messageCount: existingConversation.messages.length
        });
        
        // Save the enhanced system message
        logger.debug(`Managing enhanced system message`, { userId, channel });
        
        await saveMessage(appId, userId, channel, {
          role: 'system',
          content: systemMessage.content,
          mode: endpointMode
        });
        
        // Prepare final messages - get the managed conversation
        const managedConversation = await getOrCreateConversation(appId, userId, channel);
        
        // The conversation store has already managed the system message, so we just append new messages
        const existingMessagesWithoutCurrent = managedConversation.messages.filter(msg => 
          !(processedRequestMessages.some(reqMsg => 
            reqMsg.role === msg.role && 
            reqMsg.content === msg.content && 
            Math.abs((msg.timestamp || 0) - Date.now()) < 5000
          ))
        );
        
        finalMessages = [...existingMessagesWithoutCurrent, ...processedRequestMessages];
        
        logger.debug(`Final message preparation with conversation store`, {
          total: finalMessages.length,
          existing: existingMessagesWithoutCurrent.length,
          new: processedRequestMessages.length
        });

        // Save user messages to conversation with mode information
        let modeTransitionLogged = false;
        for (const message of processedRequestMessages) {
          if (message.role === 'user') {
            // LOG MODE TRANSITION (only once per request and only if endpoint supports multiple modes)
            if (!modeTransitionLogged) {
              // Only log mode transitions if the endpoint supports chat (meaning it can switch modes)
              const supportsMultipleModes = config.communicationModes?.supportsChat === true;
              
              if (supportsMultipleModes) {
                // Detect previous mode from conversation history
                const previousUserMessages = managedConversation.messages.filter(msg => 
                  msg.role === 'user' && msg.mode
                );
                const previousMode = previousUserMessages.length > 0 
                  ? previousUserMessages[previousUserMessages.length - 1].mode 
                  : undefined;
                
                // Only log if there's an actual transition
                if (!previousMode || previousMode !== endpointMode) {
                  logModeTransition({
                    userId,
                    appId,
                    fromMode: previousMode,
                    toMode: endpointMode || 'unspecified',
                    channel,
                    trigger: 'api_call'
                  });
                }
              }
              modeTransitionLogged = true;
            }

            await saveMessage(appId, userId, channel, {
              role: 'user',
              content: message.content,
              mode: endpointMode
            });
          }
        }
      } else {
        // NEW BEHAVIOR: Skip conversation store for pure API endpoints
        logger.debug(`Preparing messages without conversation store`, {
          systemMessageLength: systemMessage.content.length,
          requestMessageCount: processedRequestMessages.length
        });
        
        // Simply combine system message with processed request messages
        finalMessages = [systemMessage, ...processedRequestMessages];
        
        logger.debug(`Final message preparation without conversation store`, {
          total: finalMessages.length,
          system: 1,
          request: processedRequestMessages.length
        });
      }

      // CLEAN MESSAGES FOR LLM COMPATIBILITY BEFORE SENDING
      // Log summary once before cleaning
      if (shouldPrepend) {
        logger.info(`[${endpointName}] Processing ${finalMessages.filter(m => m.role === 'user').length} user messages with ID prefixing enabled`);
      }
      
      const cleanedFinalMessages = cleanMessagesForLLM(finalMessages, {
        prependUserId: shouldPrepend,
        userId: shouldPrepend ? userId : undefined,
        prependCommunicationMode: shouldPrependMode,
        endpoint: endpointName, // Pass endpoint name for better logging
        suppressLogs: true // Suppress individual message logs
      });

      // Common request parameters
      const commonRequestParams: any = {
        model,
        stream: false
      };

      if (!simplifiedTools) {
        commonRequestParams.tools = config.tools;
        commonRequestParams.tool_choice = "auto";
      }

      logger.info('Request stream parameter', { stream });
      logger.trace('Common request params', commonRequestParams);

      // G) Handle the request based on streaming preference
      if (stream) {
        try {
          // Set up streaming parameters
          const streamParams = { ...commonRequestParams, messages: cleanedFinalMessages, stream: true };
          
          // LOG THE REQUEST TO LLM - STREAMING
          logger.debug(`Making streaming LLM request`);
          if (shouldPrepend) {
            logger.debug(`User ID prepending enabled`, { userId });
          }
          if (shouldPrependMode) {
            logger.debug(`Communication mode prepending enabled`);
          }
          
          logLLMRequest(streamParams, {
            userId,
            appId,
            channel,
            endpointMode,
            conversationLength: existingConversationLength
          });

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
          let accumulatedToolCall: any = null;
          let toolExecuted = false;
          let accumulatedContent = '';
          const controllerClosed = { value: false };
          const completeResponse: any[] = [];
          
          const streamBody = new ReadableStream({
            async start(controller) {
              try {
                let inCommand = false;
                let commandBuffer = '';
                let chunkIndex = 0;
                
                for await (const part of streamingResponse) {
                  chunkIndex++;
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

                  // Handle tool calls accumulation
                  if (delta?.tool_calls) {
                    toolLogger.debug(`Tool call detected in stream`, delta.tool_calls);
                    
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
                    
                    completeResponse.push({
                      type: "tool_stream",
                      data: part
                    });
                    
                    const dataString = `data: ${JSON.stringify(part)}\n\n`;
                    controller.enqueue(encoder.encode(dataString));
                    continue;
                  }
                  
                  // Handle content with command extraction
                  if (delta?.content) {
                    accumulatedContent += delta.content;
                    
                    const modifiedPart = JSON.parse(JSON.stringify(part));
                    let modifiedContent = '';
                    let currentContent = delta.content;
                    
                    for (let i = 0; i < currentContent.length; i++) {
                      const char = currentContent[i];
                      
                      if (!inCommand && char === '<') {
                        inCommand = true;
                        commandBuffer = '<';
                      } 
                      else if (inCommand && char === '>') {
                        commandBuffer += '>';
                        inCommand = false;
                        
                        if (rtmClient && enable_rtm && agent_rtm_channel) {
                          logger.trace(`Extracted command`, { command: commandBuffer });
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
                    
                    modifiedPart.choices[0].delta.content = modifiedContent;
                    
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
                    logger.debug(`Finish reason detected`, { reason: chunk.finish_reason });
                    
                    if (accumulatedToolCall && accumulatedToolCall.function && accumulatedToolCall.function.name) {
                      logger.debug(`Executing accumulated tool call`);
                      toolExecuted = true;
                      
                      await executeToolCall(
                        accumulatedToolCall,
                        config,
                        appId,
                        userId,
                        channel,
                        cleanedFinalMessages,
                        openai,
                        model,
                        simplifiedTools,
                        completeResponse,
                        controller,
                        encoder,
                        rtmClient,
                        enable_rtm,
                        agent_rtm_channel,
                        endpointMode,
                        skipConversationStore
                      );
                      
                      endStream(controller, encoder, completeResponse, "STREAM WITH TOOL", controllerClosed);
                      return;
                    } else {
                      toolExecuted = true;
                      
                      // Save assistant response to conversation with mode (only if not skipping)
                      if (!skipConversationStore && accumulatedContent.trim()) {
                        const cleanedContent = cleanAssistantResponse(accumulatedContent.trim());
                        
                        logger.debug(`Saving assistant response`, {
                          mode: endpointMode || 'none',
                          channel
                        });
                        
                        await saveMessage(appId, userId, channel, {
                          role: 'assistant',
                          content: cleanedContent,
                          mode: endpointMode
                        });
                      }
                      
                      // Process any pending commands
                      if (inCommand && commandBuffer.length > 0) {
                        if (rtmClient && enable_rtm && agent_rtm_channel) {
                          logger.trace(`Extracted final command`, { command: commandBuffer });
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
                logger.debug(`End of stream - no finish_reason detected`);
                
                if (!skipConversationStore && accumulatedContent.trim()) {
                  const cleanedContent = cleanAssistantResponse(accumulatedContent.trim());
                  
                  await saveMessage(appId, userId, channel, {
                    role: 'assistant',
                    content: cleanedContent,
                    mode: endpointMode
                  });
                }
                
                if (inCommand && commandBuffer.length > 0) {
                  if (rtmClient && enable_rtm && agent_rtm_channel) {
                    logger.trace(`Extracted final command`, { command: commandBuffer });
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
                logger.error("OpenAI streaming error", error);
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
                    logger.error("Error while sending error to controller", controllerErr);
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
          logger.error("Stream setup error", error);
          const errorMessage = error instanceof Error ? error.message : "Unknown streaming setup error";
          const errorResponse = { error: errorMessage };
          
          logFullResponse("STREAM SETUP ERROR", errorResponse);
          
          return NextResponse.json(errorResponse, { status: 500 });
        }
      } else {
        // =====================
        // NON-STREAMING WITH MULTI-PASS TOOL CALLING
        // =====================
        let updatedMessages = [...cleanedFinalMessages];
        let passCount = 0;
        const maxPasses = 5;
        let finalResp: any = null;
        let accumulatedText = '';

        // Multi-pass logic
        while (passCount < maxPasses) {
          passCount++;
          logger.debug(`Non-stream pass`, { pass: passCount });

          logLLMRequest({
            ...commonRequestParams,
            messages: updatedMessages,
          }, {
            userId,
            appId,
            channel,
            endpointMode,
            conversationLength: existingConversationLength
          });

          const passResponse = await handleModelRequest(openai, {
            ...commonRequestParams,
            messages: updatedMessages,
          });

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
            logger.debug('No choices returned; stopping.');
            break;
          }

          if (firstChoice.message?.content) {
            accumulatedText = firstChoice.message.content;
          }

          const toolCalls = firstChoice.message?.tool_calls || [];
          if (!toolCalls.length) {
            break;
          }

          // If there are tool calls, execute them, append results
          for (const tCall of toolCalls) {
            const callName = tCall?.function?.name;
            if (!callName) continue;

            const fn = config.toolMap[callName];
            if (!fn) {
              toolLogger.error('Unknown tool name', { name: callName, available: Object.keys(config.toolMap) });
              continue;
            }
            
            let parsedArgs = {};
            try {
              parsedArgs = safeJSONParse(tCall.function?.arguments || '{}');
            } catch (err) {
              toolLogger.error('Could not parse tool arguments', err);
              continue;
            }

            toolLogger.info(`Calling tool`, { name: callName, userId, channel });

            try {
              const toolResult = await fn(appId, userId, channel, parsedArgs);
              toolLogger.debug(`Tool result`, { name: callName, result: toolResult });
              
              storeToolResponse(tCall.id, callName, toolResult);

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
              toolLogger.error(`Error executing tool`, { name: callName, error: toolError });
              const errorResult = `Error executing ${callName}: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;
              
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
        }

        if (!finalResp) {
          return NextResponse.json({ error: 'No LLM response.' }, { status: 500 });
        }

        // Save assistant response to conversation with mode (only if not skipping)
        if (!skipConversationStore && accumulatedText.trim()) {
          const cleanedText = cleanAssistantResponse(accumulatedText.trim());
          
          logger.debug(`Saving non-streaming assistant response`, {
            mode: endpointMode || 'none',
            channel
          });
          
          await saveMessage(appId, userId, channel, {
            role: 'assistant',
            content: cleanedText,
            mode: endpointMode
          });
        }

        // Extract commands from the final response text (if RTM is enabled)
        if (rtmClient && enable_rtm && agent_rtm_channel && accumulatedText) {
          let cleanedText = '';
          let inCommand = false;
          let commandBuffer = '';
          const commands = [];
          
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
          
          if (inCommand && commandBuffer.length > 0) {
            commands.push(commandBuffer + '>');
          }
          
          if (commands.length > 0) {
            logger.debug(`Extracted commands from non-streaming response`, { count: commands.length });
            for (const cmd of commands) {
              await rtmClientManager.sendMessageToChannel(
                rtmClient,
                agent_rtm_channel,
                cmd
              );
            }
            
            if (finalResp?.choices?.[0]?.message?.content) {
              finalResp.choices[0].message.content = cleanedText;
            }
            
            rtmClientManager.updateLastActive(appId, agent_rtm_uid, agent_rtm_channel);
          }
        }

        logFullResponse("NON-STREAM", finalResp);
        
        return new Response(JSON.stringify(finalResp), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error: unknown) {
      logger.error("Chat Completions Error", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const errorResponse = { error: errorMessage };
      
      logFullResponse("ERROR", errorResponse);
      
      return NextResponse.json(errorResponse, { status: 500 });
    }
  };
}