// lib/services/rtm-service.ts
// Enhanced with mode context and typing indicators
// RTM always uses mode: 'chat'
// UPDATED: Now uses channel-based conversation storage

import AgoraRTM from 'rtm-nodejs';
import { getOrCreateConversation, saveMessage, detectModeTransition } from '../common/conversation-store';
import { handleModelRequest } from '../common/model-handler';
import { exampleEndpointConfig } from '../endpoints/example-endpoint';
import { logRTMMessageProcessing, logLLMRequest, logLLMResponse, logModeTransition } from '../common/utils';
import OpenAI from 'openai';

// RTM client singleton
class RTMService {
  private static instance: RTMService;
  private rtmClient: any = null;
  private channelName: string = '';
  private initialized: boolean = false;
  
  private constructor() {}
  
  public static getInstance(): RTMService {
    if (!RTMService.instance) {
      RTMService.instance = new RTMService();
    }
    return RTMService.instance;
  }
  
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  public async initialize(): Promise<boolean> {
    if (this.initialized) {
      console.log('[RTM] Already initialized');
      return true;
    }
    
    try {
      const { RTM } = AgoraRTM;
      
      const appId = process.env.RTM_APP_ID;
      const userId = process.env.RTM_FROM_USER;
      const token = process.env.RTM_TOKEN;
      this.channelName = process.env.RTM_CHANNEL || 'default_channel';
      
      if (!appId || !userId) {
        console.error('[RTM] Missing required configuration');
        return false;
      }
      
      console.log('[RTM] Creating RTM instance');
      this.rtmClient = new RTM(appId, userId);
      
      // Set up message handlers
      this.setupEventHandlers();
      
      // Login
      const options: any = {};
      if (token) {
        options.token = token;
      }
      
      await this.rtmClient.login(options);
      console.log(`[RTM] Successfully logged in as ${userId}`);
      
      // Initialize system message for RTM (only once per user) - NOW CHANNEL-SPECIFIC
      await this.initializeRTMSystemMessage(appId, userId, this.channelName);
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('[RTM] Initialization failed:', error);
      return false;
    }
  }
  
  /**
   * Initialize the RTM system message (called once when RTM starts)
   * UPDATED: Now uses channel-based conversation storage
   */
  private async initializeRTMSystemMessage(appId: string, userId: string, channel: string): Promise<void> {
    try {
      // Create the initial RTM system message
      let rtmSystemContent = process.env.RTM_LLM_PROMPT || 
        exampleEndpointConfig.systemMessageTemplate(exampleEndpointConfig.ragData);
      
      // Add RTM-specific mode context
      rtmSystemContent += `

CURRENT COMMUNICATION MODE: CHAT (user is texting you via RTM - they can only see text)
AVAILABLE MODES: chat, video`;
      
      console.log(`[RTM] Initializing system message for ${userId} in channel ${channel}`);
      
      // Save the system message with chat mode (RTM = chat) - NOW CHANNEL-SPECIFIC
      await saveMessage(appId, userId, channel, {
        role: 'system',
        content: rtmSystemContent,
        mode: 'chat'
      });
      
      console.log(`[RTM] RTM system message initialized for ${userId} in channel ${channel}`);
    } catch (error) {
      console.error(`[RTM] Failed to initialize system message for ${userId} in channel ${channel}:`, error);
    }
  }
  
  /**
   * Send typing indicator to user
   */
  private async sendTypingIndicator(userId: string): Promise<void> {
    try {
      console.log(`[RTM] 📝 Sending typing indicator to ${userId}`);
      
      const typingPayload = {
        type: "typing",
        status: "typing"
      };
      
      const options = {
        customType: "user.typing",
        channelType: "USER",
      };
      
      await this.rtmClient.publish(userId, JSON.stringify(typingPayload), options);
      console.log(`[RTM] ✅ Typing indicator sent to ${userId}`);
    } catch (error) {
      console.error(`[RTM] ❌ Failed to send typing indicator to ${userId}:`, error);
    }
  }
  
  private setupEventHandlers() {
    this.rtmClient.addEventListener("message", async (event: any) => {
      console.log(`[RTM] RAW MESSAGE from ${event.publisher}:`, event.message);
      
      try {
        const userId = event.publisher;
        const appId = process.env.RTM_APP_ID || '';
        
        // IMMEDIATELY SEND TYPING INDICATOR (before any processing)
        await this.sendTypingIndicator(userId);
        
        // Parse message
        let messageContent = event.message;
        if (typeof event.message === 'string') {
          try {
            const parsed = JSON.parse(event.message);
            if (parsed.type === "text" && parsed.message) {
              messageContent = parsed.message;
            }
          } catch (e) {
            // Not JSON, use as is
          }
        }
        
        // LOG RTM MESSAGE PROCESSING - NOW WITH CHANNEL CONTEXT
        logRTMMessageProcessing({
          userId: event.publisher,
          appId,
          messageContent,
          channel: this.channelName,
          timestamp: Date.now()
        });
        
        // LOG MODE TRANSITION (RTM chat is always 'chat' mode)
        logModeTransition({
          userId: event.publisher,
          appId,
          fromMode: 'unknown',
          toMode: 'chat',
          channel: this.channelName,
          trigger: 'rtm_message'
        });
        
        console.log(`[RTM] PROCESSED MESSAGE from ${event.publisher} in channel ${this.channelName}:`, messageContent);
        const model = process.env.RTM_LLM_MODEL || 'gpt-4o-mini';
        const baseURL = process.env.RTM_LLM_BASE_URL || 'https://api.openai.com/v1';
        
        // Get or create conversation - NOW CHANNEL-SPECIFIC
        const conversation = await getOrCreateConversation(appId, userId, this.channelName);
        
        // DETECT MODE TRANSITION - Check if user just came from video
        const modeTransition = detectModeTransition(conversation);
        console.log(`[RTM] Mode transition analysis for channel ${this.channelName}:`, modeTransition);
        
        // Add user message with CHAT mode (RTM = chat) - NOW CHANNEL-SPECIFIC
        await saveMessage(appId, userId, this.channelName, {
          role: 'user',
          content: messageContent,
          mode: 'chat'
        });
        
        console.log(`[RTM] SAVED USER MESSAGE with mode: chat for ${userId} in channel ${this.channelName}`);
        
        // Process with LLM
        const openai = new OpenAI({
          apiKey: process.env.RTM_LLM_API_KEY,
          baseURL
        });
        
        // Get updated conversation - system message is already managed by conversation store - NOW CHANNEL-SPECIFIC
        const updatedConversation = await getOrCreateConversation(appId, userId, this.channelName);
        const messages = updatedConversation.messages; // Use existing messages with managed system message
        
        // Create request parameters
        const requestParams = {
          model,
          messages,
          tools: exampleEndpointConfig.tools,
          tool_choice: 'auto'
        };
        
        // LOG THE RTM LLM REQUEST
        console.log(`[RTM] 🚀 MAKING LLM REQUEST FOR RTM CHAT in channel ${this.channelName}`);
        logLLMRequest(requestParams, {
          userId,
          appId,
          channel: this.channelName,
          endpointMode: 'chat',
          conversationLength: updatedConversation.messages.length
        });
        
        // Process with LLM
        const response = await handleModelRequest(openai, requestParams);
        
        // LOG THE RTM LLM RESPONSE
        logLLMResponse(response, {
          userId,
          appId,
          channel: this.channelName,
          endpointMode: 'chat',
          requestType: 'non-streaming'
        });
        
        // Handle response and tool calls
        const choice = response.choices[0];
        let finalResponse = choice.message.content || '';
        
        // Handle tool calls if present
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          console.log(`[RTM] 🔧 Processing ${choice.message.tool_calls.length} tool calls for channel ${this.channelName}`);
          
          for (const toolCall of choice.message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            
            console.log(`[RTM] 🔧 Executing tool: ${toolName} in channel ${this.channelName}`, toolArgs);
            
            // Handle all tools using the proper endpoint toolMap
            if (exampleEndpointConfig.toolMap[toolName]) {
              try {
                const toolResult = await exampleEndpointConfig.toolMap[toolName](appId, userId, this.channelName, toolArgs);
                console.log(`[RTM] 🔧 Tool ${toolName} result for channel ${this.channelName}:`, toolResult);
                
                // Add tool result to response
                finalResponse += `\n\n${toolResult}`;
              } catch (toolError) {
                console.error(`[RTM] ❌ Tool ${toolName} error in channel ${this.channelName}:`, toolError);
                finalResponse += `\n\nSorry, there was an issue with ${toolName}.`;
              }
            } else {
              console.error(`[RTM] ❌ Unknown tool: ${toolName}`);
              finalResponse += `\n\nSorry, I don't recognize the ${toolName} tool.`;
            }
          }
        }
        
        console.log(`[RTM] 🤖 LLM RESPONSE for RTM CHAT in channel ${this.channelName}:`, finalResponse);

        // Save assistant response with CHAT mode (RTM = chat) - NOW CHANNEL-SPECIFIC
        console.log(`[RTM] 💾 SAVING ASSISTANT RESPONSE WITH MODE: chat for ${userId} in channel ${this.channelName}`);
        console.log(`[RTM] Response content length: ${finalResponse.length} chars`);
        console.log(`[RTM] Response preview: ${finalResponse.substring(0, 100)}${finalResponse.length > 100 ? '...' : ''}`);
        
        await saveMessage(appId, userId, this.channelName, {
          role: 'assistant',
          content: finalResponse,
          mode: 'chat'
        });
        
        console.log(`[RTM] SAVED ASSISTANT RESPONSE with mode: chat for ${userId} in channel ${this.channelName}`);
        
        // Send response back
        const responsePayload = {
          type: "text",
          message: finalResponse,
          recipient: userId
        };
        
        const options = {
          customType: "user.transcription",
          channelType: "USER",
        };
        
        console.log(`[RTM] 📤 SENDING RESPONSE TO ${event.publisher} in channel ${this.channelName}`);
        console.log(`[RTM] Response payload:`, responsePayload);
        
        // Send message to the channel using the channel-specific target
        await this.rtmClient.publish(event.publisher, finalResponse, options);
        console.log(`[RTM] ✅ RESPONSE SENT TO ${event.publisher} in channel ${this.channelName}`);
        
      } catch (error) {
        console.error('[RTM] ❌ ERROR PROCESSING MESSAGE:', error);
        
        // Try to send error response to user
        try {
          await this.rtmClient.publish(event.publisher, "Sorry, I encountered an error processing your message.", {
            customType: "user.transcription",
            channelType: "USER",
          });
        } catch (sendError) {
          console.error('[RTM] ❌ Failed to send error response:', sendError);
        }
      }
    });
    
    // Other event handlers
    this.rtmClient.addEventListener("presence", (event: any) => {
      console.log(`[RTM] Presence event in channel ${this.channelName}:`, event);
    });
    
    this.rtmClient.addEventListener("status", (event: any) => {
      console.log(`[RTM] Status changed to ${event.state} for channel ${this.channelName}`);
    });
  }
  
  public async sendMessage(message: string): Promise<boolean> {
    if (!this.initialized || !this.rtmClient) {
      console.error('[RTM] Not initialized');
      return false;
    }
    
    try {
      const payload = {
        type: "text",
        message
      };
      
      await this.rtmClient.publish(this.channelName, JSON.stringify(payload));
      console.log(`[RTM] Message sent to channel ${this.channelName}`);
      return true;
    } catch (error) {
      console.error(`[RTM] Error sending message to channel ${this.channelName}:`, error);
      return false;
    }
  }
}

export default RTMService.getInstance();