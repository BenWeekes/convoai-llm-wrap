// lib/common/rtm-chat-handler.ts
// Shared RTM chat handler that any endpoint can use for seamless voice/chat integration
// Enhanced with communication mode support
// FIXED: Store model in session to avoid re-reading from environment

import rtmClientManager from './rtm-client-manager';
import { getOrCreateConversation, saveMessage } from './conversation-store';
import { handleModelRequest } from './model-handler';
import { insertCachedToolResponses } from './message-processor';
import { storeToolResponse } from './cache';
import { generateCallId, safeJSONParse } from './utils';
import OpenAI from 'openai';
import type { EndpointConfig } from '../types';

// Track active endpoint chat sessions
interface EndpointChatSession {
  config: EndpointConfig;
  currentSystemMessage: string | null; // null means use default prompt
  rtmClient: any;
  openai: OpenAI;
  environmentPrefix: string;
  model: string; // ADDED: Store model to avoid re-reading from env
  baseURL: string; // ADDED: Store baseURL for consistency
}

class EndpointChatManager {
  private static instance: EndpointChatManager;
  private activeSessions: Map<string, EndpointChatSession> = new Map();

  private constructor() {}

  public static getInstance(): EndpointChatManager {
    if (!EndpointChatManager.instance) {
      EndpointChatManager.instance = new EndpointChatManager();
    }
    return EndpointChatManager.instance;
  }

  /**
   * Initialize RTM chat for an endpoint (called on first API access)
   */
  public async initializeEndpointChat(
    endpointName: string, 
    config: EndpointConfig
  ): Promise<boolean> {
    const sessionKey = endpointName.toUpperCase();
    
    // Check if endpoint supports chat mode
    const supportsChat = config.communicationModes?.supportsChat || false;
    if (!supportsChat) {
      console.log(`[RTM-CHAT] ${endpointName} does not support chat mode - skipping RTM initialization`);
      return false;
    }
    
    // Skip if already initialized
    if (this.activeSessions.has(sessionKey)) {
      console.log(`[RTM-CHAT] ${endpointName} chat already initialized`);
      return true;
    }

    try {
      const envPrefix = `${sessionKey}_RTM`;
      
      // Read environment variables
      const appId = process.env[`${envPrefix}_APP_ID`];
      const token = process.env[`${envPrefix}_TOKEN`];
      const fromUser = process.env[`${envPrefix}_FROM_USER`];
      const channel = process.env[`${envPrefix}_CHANNEL`];
      const model = process.env[`${envPrefix}_LLM_MODEL`] || 'gpt-4o-mini';
      const baseURL = process.env[`${envPrefix}_LLM_BASE_URL`] || 'https://api.openai.com/v1';
      const apiKey = process.env[`${envPrefix}_LLM_API_KEY`];
      const defaultPrompt = process.env[`${envPrefix}_LLM_PROMPT`] || '';

      // Validate required environment variables
      if (!appId || !fromUser || !channel || !apiKey) {
        console.log(`[RTM-CHAT] ${endpointName} RTM chat not configured - missing environment variables`);
        console.log(`[RTM-CHAT] Required: ${envPrefix}_APP_ID, ${envPrefix}_FROM_USER, ${envPrefix}_CHANNEL, ${envPrefix}_LLM_API_KEY`);
        return false;
      }

      console.log(`[RTM-CHAT] Initializing ${endpointName} chat with appId: ${appId}, user: ${fromUser}, channel: ${channel}`);
      console.log(`[RTM-CHAT] Using model: ${model}, baseURL: ${baseURL}`); // Log the stored values

      // Create OpenAI client
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseURL
      });

      // Create RTM client
      const rtmClient = await rtmClientManager.getOrCreateClient({
        enable_rtm: true,
        agent_rtm_uid: fromUser,
        agent_rtm_token: token,
        agent_rtm_channel: channel,
        appId: appId
      });

      if (!rtmClient) {
        console.error(`[RTM-CHAT] Failed to create RTM client for ${endpointName}`);
        return false;
      }

      // Store session with model and baseURL cached
      const session: EndpointChatSession = {
        config,
        currentSystemMessage: null, // Start with default prompt
        rtmClient,
        openai,
        environmentPrefix: envPrefix,
        model: model,     // FIXED: Store model value
        baseURL: baseURL  // ADDED: Store baseURL for consistency
      };

      this.activeSessions.set(sessionKey, session);

      // Set up message handler
      rtmClientManager.addMessageHandler(
        appId,
        fromUser,
        channel,
        (event) => this.handleChatMessage(sessionKey, appId, event)
      );

      console.log(`[RTM-CHAT] ${endpointName} chat initialized successfully (supports chat + ${config.communicationModes?.endpointMode || 'unknown'})`);
      console.log(`[RTM-CHAT] Cached model: ${session.model}, baseURL: ${session.baseURL}`);
      return true;

    } catch (error) {
      console.error(`[RTM-CHAT] Error initializing ${endpointName} chat:`, error);
      return false;
    }
  }

  /**
   * Update system message for an endpoint (called when voice session starts with custom system message)
   */
  public updateSystemMessage(endpointName: string, appId: string, systemMessage: string): void {
    const sessionKey = endpointName.toUpperCase();
    const session = this.activeSessions.get(sessionKey);
    
    if (session) {
      session.currentSystemMessage = systemMessage;
      console.log(`[RTM-CHAT] Updated system message for ${endpointName} (appId: ${appId})`);
      console.log(`[RTM-CHAT] New system message: ${systemMessage.substring(0, 100)}...`);
    } else {
      console.warn(`[RTM-CHAT] Cannot update system message: ${endpointName} not initialized`);
    }
  }

  /**
   * Send a direct message to a specific user (not channel)
   */
  private async sendDirectMessageToUser(
    rtmClient: any, 
    userId: string, 
    message: string
  ): Promise<boolean> {
    if (!rtmClient) {
      return false;
    }

    try {
      const options = {
        customType: "user.transcription",
        channelType: "USER",
      };

      console.log(`[RTM-CHAT] Sending direct message to user ${userId}: ${message}`);
      await rtmClient.publish(userId, message, options);
      console.log(`[RTM-CHAT] Direct message sent successfully to ${userId}`);
      return true;
    } catch (error) {
      console.error(`[RTM-CHAT] Error sending direct message to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Handle incoming chat message with communication mode awareness
   */
  private async handleChatMessage(sessionKey: string, appId: string, event: any): Promise<void> {
    const session = this.activeSessions.get(sessionKey);
    if (!session) {
      console.error(`[RTM-CHAT] No session found for ${sessionKey}`);
      return;
    }

    try {
      // Extract publisher (userId) and message content from RTM event
      let userId: string;
      let messageContent: string = '';
      
      // RTM event should have structure: { publisher: "user_id", message: "content" }
      if (event && typeof event === 'object') {
        if (event.publisher) {
          userId = event.publisher;
          messageContent = event.message || '';
        } else {
          console.warn(`[RTM-CHAT] RTM event missing publisher:`, event);
          return; // Don't process messages without a clear sender
        }
      } else {
        console.warn(`[RTM-CHAT] Invalid RTM event format:`, event);
        return;
      }

      // Additional message content parsing if needed
      if (typeof messageContent === 'string') {
        try {
          const parsed = JSON.parse(messageContent);
          if (parsed.type === "text" && parsed.message) {
            messageContent = parsed.message;
          }
        } catch (e) {
          // Not JSON, use as string - this is fine
        }
      }

      console.log(`[RTM-CHAT] Processing message from ${userId}: ${messageContent}`);

      // Get or create conversation
      const conversation = await getOrCreateConversation(appId, userId);

      // Add user message to conversation with CHAT mode (since this is RTM)
      await saveMessage(appId, userId, {
        role: 'user',
        content: messageContent,
        mode: 'chat' // Always chat mode for RTM messages
      });

      // Determine system message to use with communication mode context
      let systemMessage: string;
      if (session.currentSystemMessage) {
        // Use custom system message from voice session
        systemMessage = session.currentSystemMessage;
      } else {
        // Use default prompt from environment or endpoint config
        const defaultPrompt = process.env[`${session.environmentPrefix}_LLM_PROMPT`];
        systemMessage = defaultPrompt || session.config.systemMessageTemplate(session.config.ragData);
      }

      // Add communication mode context to system message
      const endpointMode = session.config.communicationModes?.endpointMode;
      let currentModeContext = '';
      
      if (endpointMode === 'video') {
        currentModeContext = `

CURRENT COMMUNICATION MODE: CHAT (user is texting you right now)
AVAILABLE MODES: chat, video`;
      } else if (endpointMode === 'voice') {
        currentModeContext = `

CURRENT COMMUNICATION MODE: CHAT (user is texting you right now)  
AVAILABLE MODES: chat, voice`;
      } else {
        // Chat only mode
        currentModeContext = `

CURRENT COMMUNICATION MODE: CHAT (user is texting you - chat only endpoint)
AVAILABLE MODES: chat`;
      }

      // Append mode context to system message
      systemMessage += currentModeContext;

      // Prepare messages for LLM
      let messages = [...conversation.messages];
      
      // Insert cached tool responses if needed
      messages = insertCachedToolResponses(messages);

      // Ensure system message is first
      const hasSystemMessage = messages.some(msg => msg.role === 'system');
      if (!hasSystemMessage) {
        messages.unshift({
          role: 'system',
          content: systemMessage
        });
      } else {
        // Update existing system message
        const systemIndex = messages.findIndex(msg => msg.role === 'system');
        if (systemIndex !== -1) {
          messages[systemIndex].content = systemMessage;
        }
      }

      // Create LLM request using cached model value
      const requestParams: any = {
        model: session.model,  // FIXED: Use cached model instead of re-reading from env
        messages,
        tools: session.config.tools,
        tool_choice: 'auto'
      };

      console.log(`[RTM-CHAT] Making LLM request with ${messages.length} messages using model: ${session.model}`);

      // Handle multi-pass tool calling
      let passCount = 0;
      const maxPasses = 5;
      let finalResponse: any = null;

      while (passCount < maxPasses) {
        passCount++;
        console.log(`[RTM-CHAT] Pass #${passCount}`);

        const response = await handleModelRequest(session.openai, requestParams);
        finalResponse = response;

        const firstChoice = response?.choices?.[0];
        if (!firstChoice) {
          console.log('[RTM-CHAT] No choices returned; stopping.');
          break;
        }

        const toolCalls = firstChoice.message?.tool_calls || [];
        if (!toolCalls.length) {
          // No tool calls, we're done
          break;
        }

        // Execute tool calls
        for (const tCall of toolCalls) {
          const callName = tCall?.function?.name;
          if (!callName) continue;

          const fn = session.config.toolMap[callName];
          if (!fn) {
            console.error(`[RTM-CHAT] Unknown tool name: ${callName}`);
            continue;
          }

          let parsedArgs = {};
          try {
            parsedArgs = safeJSONParse(tCall.function?.arguments || '{}');
          } catch (err) {
            console.error('[RTM-CHAT] Could not parse tool arguments:', err);
            continue;
          }

          console.log(`[RTM-CHAT] Executing tool ${callName} for ${userId}`);

          try {
            const toolResult = await fn(appId, userId, 'rtm_chat', parsedArgs);
            console.log(`[RTM-CHAT] Tool result for ${callName}:`, toolResult);

            storeToolResponse(tCall.id, callName, toolResult);

            // Add tool call and result to messages
            requestParams.messages.push({
              role: 'assistant',
              content: '',
              tool_calls: [tCall],
            });
            requestParams.messages.push({
              role: 'tool',
              name: callName,
              content: toolResult,
              tool_call_id: tCall.id,
            });
          } catch (toolError) {
            console.error(`[RTM-CHAT] Error executing tool ${callName}:`, toolError);
            const errorResult = `Error executing ${callName}: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;

            requestParams.messages.push({
              role: 'assistant',
              content: '',
              tool_calls: [tCall],
            });
            requestParams.messages.push({
              role: 'tool',
              name: callName,
              content: errorResult,
              tool_call_id: tCall.id,
            });
          }
        }
      }

      // Get final response content
      let finalContent = finalResponse?.choices?.[0]?.message?.content || 'I apologize, but I was unable to generate a response.';

      // Extract and process commands (similar to endpoint-factory)
      let cleanedContent = '';
      let inCommand = false;
      let commandBuffer = '';
      const commands = [];

      for (let i = 0; i < finalContent.length; i++) {
        const char = finalContent[i];

        if (!inCommand && char === '<') {
          inCommand = true;
          commandBuffer = '<';
        } else if (inCommand && char === '>') {
          commandBuffer += '>';
          commands.push(commandBuffer);
          inCommand = false;
          commandBuffer = '';
        } else if (inCommand) {
          commandBuffer += char;
        } else {
          cleanedContent += char;
        }
      }

      // Process any remaining command buffer
      if (inCommand && commandBuffer.length > 0) {
        commands.push(commandBuffer + '>');
      }

      // Send commands to user if any
      if (commands.length > 0) {
        console.log(`[RTM-CHAT] Extracted ${commands.length} commands from response`);
        for (const cmd of commands) {
          await this.sendDirectMessageToUser(session.rtmClient, userId, cmd);
        }
      }

      // Use cleaned content for the text response
      const responseText = cleanedContent || finalContent;

      console.log(`[RTM-CHAT] Sending response to ${userId}: ${responseText}`);

      // Send simple typing indicator
      await this.sendDirectMessageToUser(session.rtmClient, userId, JSON.stringify({
        type: "typing_start"
      }));

      // Save assistant response to conversation immediately with CHAT mode
      await saveMessage(appId, userId, {
        role: 'assistant',
        content: responseText,
        mode: 'chat' // Always chat mode for RTM responses
      });

      // Calculate delay based on message length (more realistic)
      // Base: 1.3 seconds + (message length * faster typing speed) + random variance
      const baseDelay = 300; // ~1.3 seconds minimum (reduced from 2s)
      const wordsPerMinute = 300; // Faster typing speed (increased from 40 WPM)
      const msPerCharacter = (60 * 1000) / (wordsPerMinute * 5); // ~5 chars per word
      const typingDelay = Math.min(responseText.length * msPerCharacter, 6700); // Max ~6.7 seconds for typing (reduced from 10s)
      const randomVariance = Math.random() * 300; // 0-1.3 seconds random (reduced from 2s)
      const totalDelay = Math.min(baseDelay + typingDelay + randomVariance, 2000); // Cap at 8 seconds (reduced from 12s)
      
      console.log(`[RTM-CHAT] Message length: ${responseText.length} chars, delay: ${Math.round(totalDelay)}ms`);

      // Send actual response after calculated delay (non-blocking)
      setTimeout(async () => {
        try {
          await this.sendDirectMessageToUser(session.rtmClient, userId, responseText);
          console.log(`[RTM-CHAT] Delayed response sent successfully to ${userId}`);
        } catch (error) {
          console.error(`[RTM-CHAT] Error sending delayed response to ${userId}:`, error);
        }
      }, totalDelay);

      console.log(`[RTM-CHAT] Response sent successfully to ${userId}`);

    } catch (error) {
      console.error('[RTM-CHAT] Error processing chat message:', error);
      // No error response sent to user - keeps conversation natural
    }
  }

  /**
   * Get status of all active chat sessions
   */
  public getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Check if an endpoint has chat initialized
   */
  public isEndpointChatActive(endpointName: string): boolean {
    return this.activeSessions.has(endpointName.toUpperCase());
  }

  /**
   * Get session info for debugging
   */
  public getSessionInfo(endpointName: string): any {
    const sessionKey = endpointName.toUpperCase();
    const session = this.activeSessions.get(sessionKey);
    
    if (!session) {
      return null;
    }

    return {
      endpointName,
      supportsChat: session.config.communicationModes?.supportsChat || false,
      endpointMode: session.config.communicationModes?.endpointMode || 'none',
      environmentPrefix: session.environmentPrefix,
      hasCustomSystemMessage: !!session.currentSystemMessage,
      model: session.model,        // ADDED: Show cached model
      baseURL: session.baseURL     // ADDED: Show cached baseURL
    };
  }
}

// Export singleton instance
const endpointChatManager = EndpointChatManager.getInstance();
export default endpointChatManager;