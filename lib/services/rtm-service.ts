// lib/services/rtm-service.ts
// Enhanced with configurable debug logging for RTM interactions

import AgoraRTM from 'rtm-nodejs';
import { getOrCreateConversation, saveMessage } from '../common/conversation-store';
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
      
      /*
      // Subscribe to channel
      await this.rtmClient.subscribe(this.channelName);
      console.log(`[RTM] Subscribed to channel: ${this.channelName}`);
      
      // Send a startup message
      const startupPayload = {
        type: "text",
        message: `RTM service initialized and listening on channel ${this.channelName}`
      };
      
      await this.rtmClient.publish(this.channelName, JSON.stringify(startupPayload));
      */

      this.initialized = true;
      return true;
    } catch (error) {
      console.error('[RTM] Initialization failed:', error);
      return false;
    }
  }
  
  private setupEventHandlers() {
    this.rtmClient.addEventListener("message", async (event: any) => {
      console.log(`[RTM] RAW MESSAGE from ${event.publisher}:`, event.message);
      
      try {
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
        
        // LOG RTM MESSAGE PROCESSING
        logRTMMessageProcessing({
          userId: event.publisher,
          appId: process.env.RTM_APP_ID || '',
          messageContent,
          channel: this.channelName,
          timestamp: Date.now()
        });
        
        // LOG MODE TRANSITION (RTM chat is always 'chat' mode)
        logModeTransition({
          userId: event.publisher,
          appId: process.env.RTM_APP_ID || '',
          fromMode: 'unknown',
          toMode: 'chat',
          channel: this.channelName,
          trigger: 'rtm_message'
        });
        
        console.log(`[RTM] PROCESSED MESSAGE from ${event.publisher}:`, messageContent);
        const userId = event.publisher;
        const appId = process.env.RTM_APP_ID || '';
        const model = process.env.RTM_LLM_MODEL || 'gpt-4o-mini';
        const baseURL = process.env.RTM_LLM_BASE_URL || 'https://api.openai.com/v1';
        
        // Get or create conversation
        const conversation = await getOrCreateConversation(appId, userId);
        
        // Add user message with CHAT mode
        await saveMessage(appId, userId, {
          role: 'user',
          content: messageContent,
          mode: 'chat' // RTM messages are always chat mode
        });
        
        console.log(`[RTM] SAVED USER MESSAGE with mode: chat`);
        
        // Process with LLM
        const openai = new OpenAI({
          apiKey: process.env.RTM_LLM_API_KEY,
          baseURL
        });
        
        // Prepare messages - get updated conversation after saving user message
        const updatedConversation = await getOrCreateConversation(appId, userId);
        let messages = updatedConversation.messages;
        
        // Add system message if not present
        if (!messages.some(msg => msg.role === 'system')) {
          const systemContent = process.env.RTM_LLM_PROMPT || 
            exampleEndpointConfig.systemMessageTemplate(exampleEndpointConfig.ragData);
          
          // Add chat mode context to system message
          const chatModeContext = `

CURRENT COMMUNICATION MODE: CHAT (user is texting you via RTM)
AVAILABLE MODES: chat, video`;
          
          messages = [
            {
              role: 'system',
              content: systemContent + chatModeContext,
              mode: 'chat'
            },
            ...messages
          ];
        }
        
        // Create request parameters
        const requestParams = {
          model,
          messages,
          tools: exampleEndpointConfig.tools,
          tool_choice: 'auto'
        };
        
        // LOG THE RTM LLM REQUEST
        console.log(`[RTM] 🚀 MAKING LLM REQUEST FOR RTM CHAT`);
        logLLMRequest(requestParams, {
          userId,
          appId,
          channel: this.channelName,
          endpointMode: 'chat', // RTM is always chat mode
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
        
        // Handle response and tool calls (simplified)
        let finalResponse = response.choices[0].message.content || '';
        
        console.log(`[RTM] 🤖 LLM RESPONSE for RTM CHAT:`, finalResponse);

        // Save assistant response with CHAT mode
        console.log(`[RTM] 💾 SAVING ASSISTANT RESPONSE WITH MODE: chat`);
        console.log(`[RTM] Response content length: ${finalResponse.length} chars`);
        console.log(`[RTM] Response preview: ${finalResponse.substring(0, 100)}${finalResponse.length > 100 ? '...' : ''}`);
        
        await saveMessage(appId, userId, {
          role: 'assistant',
          content: finalResponse,
          mode: 'chat' // RTM responses are always chat mode
        });
        
        console.log(`[RTM] SAVED ASSISTANT RESPONSE with mode: chat`);
        
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
        
        console.log(`[RTM] 📤 SENDING RESPONSE TO ${event.publisher}`);
        console.log(`[RTM] Response payload:`, responsePayload);
        
        // Send message to the channel using the channel-specific target
        await this.rtmClient.publish(event.publisher, finalResponse, options);
        console.log(`[RTM] ✅ RESPONSE SENT TO ${event.publisher}`);
        
      } catch (error) {
        console.error('[RTM] ❌ ERROR PROCESSING MESSAGE:', error);
      }
    });
    
    // Other event handlers
    this.rtmClient.addEventListener("presence", (event: any) => {
      console.log(`[RTM] Presence event:`, event);
    });
    
    this.rtmClient.addEventListener("status", (event: any) => {
      console.log(`[RTM] Status changed to ${event.state}`);
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
      return true;
    } catch (error) {
      console.error('[RTM] Error sending message:', error);
      return false;
    }
  }
}

export default RTMService.getInstance();