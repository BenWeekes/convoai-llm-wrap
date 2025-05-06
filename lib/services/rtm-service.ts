// lib/services/rtm-service.ts

import AgoraRTM from 'rtm-nodejs';
import { getOrCreateConversation, saveMessage } from '../common/conversation-store';
import { handleModelRequest } from '../common/model-handler';
import { exampleEndpointConfig } from '../endpoints/example-endpoint';
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
      
      // Subscribe to channel
      await this.rtmClient.subscribe(this.channelName);
      console.log(`[RTM] Subscribed to channel: ${this.channelName}`);
      
      // Send a startup message
      const startupPayload = {
        type: "text",
        message: `RTM service initialized and listening on channel ${this.channelName}`
      };
      
      await this.rtmClient.publish(this.channelName, JSON.stringify(startupPayload));
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('[RTM] Initialization failed:', error);
      return false;
    }
  }
  
  private setupEventHandlers() {
    this.rtmClient.addEventListener("message", async (event: any) => {
      console.log(`[RTM] 📩 CHANNEL MESSAGE from ${event.publisher}:`, event.message);
      
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
        
        const userId = event.publisher;
        const appId = process.env.RTM_APP_ID || '';
        const model = process.env.RTM_LLM_MODEL || 'gpt-4o-mini';
        const baseURL = process.env.RTM_LLM_BASE_URL || 'https://api.openai.com/v1';
        
        // Get or create conversation
        const conversation = await getOrCreateConversation(appId, userId);
        
        // Add user message
        await saveMessage(appId, userId, {
          role: 'user',
          content: messageContent
        });
        
        // Process with LLM
        const openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          baseURL
        });
        
        // Prepare messages
        let messages = conversation.messages;
        if (!messages.some(msg => msg.role === 'system')) {
          messages = [
            {
              role: 'system',
              content: exampleEndpointConfig.systemMessageTemplate(exampleEndpointConfig.ragData)
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
        
        // Process with LLM
        const response = await handleModelRequest(openai, requestParams);
        
        // Handle response and tool calls (simplified)
        let finalResponse = response.choices[0].message.content || '';
        
        // Save assistant response
        await saveMessage(appId, userId, {
          role: 'assistant',
          content: finalResponse
        });
        
        // Send response back
        const responsePayload = {
          type: "text",
          message: finalResponse,
          recipient: userId
        };
        
        await this.rtmClient.publish(this.channelName, JSON.stringify(responsePayload));
      } catch (error) {
        console.error('[RTM] Error processing message:', error);
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
