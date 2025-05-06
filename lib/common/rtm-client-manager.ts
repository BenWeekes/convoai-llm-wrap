// lib/common/rtm-client-manager.ts
// Manages RTM client connections with automatic timeout

import AgoraRTM from 'rtm-nodejs';

// RTM session information
export interface RTMClientSession {
  rtmClient: any; // Explicitly use 'any' type to match rtm-service.ts
  lastActive: number;
  channelName: string;
  userId: string;
  appId: string;
  messageHandlers: RTMMessageHandler[];
}

// Message handler type
export type RTMMessageHandler = (message: any) => void;

export type RTMClientParams = {
  enable_rtm?: boolean;
  agent_rtm_uid?: string;
  agent_rtm_token?: string;
  agent_rtm_channel?: string;
  appId: string; // Required parameter
}

// Simplified logging function
function logRtm(message: string, ...args: any[]) {
  console.log(`[RTM] ${message}`, ...args);
}

// Client manager that handles multiple RTM connections
class RTMClientManager {
  private static instance: RTMClientManager;
  private clients: Map<string, RTMClientSession> = new Map();
  private timeoutId: NodeJS.Timeout | null = null;
  private cleanupIntervalMs: number = 10000; // Check every 10 seconds
  private sessionTimeoutMs: number = 60000; // 60 seconds timeout

  constructor() {
    this.startCleanupTimer();
    logRtm("RTM Client Manager initialized");
  }

  private startCleanupTimer() {
    if (this.timeoutId) {
      clearInterval(this.timeoutId);
    }

    this.timeoutId = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupIntervalMs);
  }

  private cleanupInactiveSessions() {
    const now = Date.now();
    let removedCount = 0;

    // Convert Map entries to array and then iterate
    Array.from(this.clients.entries()).forEach(([key, session]) => {
      if (now - session.lastActive > this.sessionTimeoutMs) {
        // Logout and clean up
        try {
          logRtm(`Auto-logging out inactive client: ${session.userId} from channel ${session.channelName}`);
          session.rtmClient.logout();
        } catch (error) {
          console.error(`[RTM] Error during logout for ${session.userId}:`, error);
        }

        this.clients.delete(key);
        removedCount++;
      }
    });

    if (removedCount > 0) {
      logRtm(`Cleaned up ${removedCount} inactive RTM clients`);
    }
  }

  /**
   * Generate a unique session key for an RTM client
   */
  private getSessionKey(appId: string, userId: string, channelName: string): string {
    return `${appId}:${userId}:${channelName}`;
  }

  /**
   * Sets up message event listeners for an RTM client
   */
  private setupMessageListeners(rtmClient: any, appId: string, userId: string, channelName: string): void {
    // Add message event listener
    rtmClient.addEventListener("message", (event: any) => {
      logRtm(`Received message on channel ${channelName}:`, event);
      
      try {
        // Parse message content if it's a string
        let messageContent = event.message;
        if (typeof event.message === 'string') {
          try {
            const parsed = JSON.parse(event.message);
            messageContent = parsed;
          } catch (e) {
            // Not JSON or invalid JSON, use as is
            logRtm("Message is not valid JSON, using raw string");
          }
        }
        
        // Get session to access message handlers
        const sessionKey = this.getSessionKey(appId, userId, channelName);
        const session = this.clients.get(sessionKey);
        
        if (session) {
          // Update last active time
          session.lastActive = Date.now();
          
          // Call all registered message handlers
          session.messageHandlers.forEach(handler => {
            try {
              handler(messageContent);
            } catch (handlerError) {
              console.error('[RTM] Error in message handler:', handlerError);
            }
          });
        }
      } catch (error) {
        console.error('[RTM] Error processing received message:', error);
      }
    });
    
    // Add other event listeners
    rtmClient.addEventListener("presence", (event: any) => {
      logRtm(`Presence event on channel ${channelName}:`, event);
    });
    
    rtmClient.addEventListener("status", (event: any) => {
      logRtm(`Status changed to ${event.state} for ${userId} in channel ${channelName}`);
    });
  }

  /**
   * Gets an RTM client, creating a new one if necessary
   */
  public async getOrCreateClient(params: RTMClientParams): Promise<any | null> {
    // If RTM is not enabled, return null
    if (!params.enable_rtm || !params.agent_rtm_uid || !params.agent_rtm_channel || !params.appId) {
      return null;
    }

    const appId = params.appId;
    const userId = params.agent_rtm_uid;
    const token = params.agent_rtm_token;
    const channelName = params.agent_rtm_channel;
    const sessionKey = this.getSessionKey(appId, userId, channelName);

    // Check if we already have an active client
    if (this.clients.has(sessionKey)) {
      const session = this.clients.get(sessionKey)!;
      session.lastActive = Date.now(); // Update last activity timestamp
      logRtm(`Reusing existing client for ${userId} in channel ${channelName} (appId: ${appId})`);
      return session.rtmClient;
    }

    try {
      logRtm(`Creating new client for ${userId} in channel ${channelName} (appId: ${appId})`);
      
      // Use the RTM constructor from the AgoraRTM package - explicitly cast as any
      const rtmClient: any = new (AgoraRTM.RTM)(appId, userId);
      
      // Login options
      const loginOptions = token ? { token } : {};
      
      // Login
      logRtm(`Attempting login for user ${userId}`, loginOptions);
      await rtmClient.login(loginOptions);
      logRtm(`Successfully logged in as ${userId}`);

      // Subscribe to channel
      await rtmClient.subscribe(channelName);
      logRtm(`Subscribed to channel: ${channelName}`);
      
      // Create session before setting up listeners
      const session: RTMClientSession = {
        rtmClient,
        lastActive: Date.now(),
        channelName,
        userId,
        appId,
        messageHandlers: []
      };
      
      // Store the session
      this.clients.set(sessionKey, session);
      
      // Set up message listeners
      this.setupMessageListeners(rtmClient, appId, userId, channelName);

      return rtmClient;
    } catch (error) {
      console.error('[RTM] Error creating RTM client:', error);
      // On error, provide more detailed information about the parameters to help debug
      console.error('[RTM] Failed params:', { 
        userId,
        channelName,
        appId,
        hasToken: !!token
      });
      return null;
    }
  }

  /**
   * Registers a message handler for a specific client session
   */
  public addMessageHandler(
    appId: string,
    userId: string,
    channelName: string,
    handler: RTMMessageHandler
  ): boolean {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    const session = this.clients.get(sessionKey);
    
    if (!session) {
      console.error(`[RTM] Cannot add message handler: No active session for ${userId} in channel ${channelName}`);
      return false;
    }
    
    // Add the handler
    session.messageHandlers.push(handler);
    logRtm(`Added message handler for ${userId} in channel ${channelName} (total: ${session.messageHandlers.length})`);
    return true;
  }

  /**
   * Removes a message handler for a specific client session
   */
  public removeMessageHandler(
    appId: string,
    userId: string,
    channelName: string,
    handler: RTMMessageHandler
  ): boolean {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    const session = this.clients.get(sessionKey);
    
    if (!session) {
      console.error(`[RTM] Cannot remove message handler: No active session for ${userId} in channel ${channelName}`);
      return false;
    }
    
    // Find the handler index
    const index = session.messageHandlers.indexOf(handler);
    if (index !== -1) {
      // Remove the handler
      session.messageHandlers.splice(index, 1);
      logRtm(`Removed message handler for ${userId} in channel ${channelName} (remaining: ${session.messageHandlers.length})`);
      return true;
    }
    
    return false;
  }

  /**
   * Updates the last active timestamp for a session
   */
  public updateLastActive(appId: string, userId: string, channelName: string): void {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    const session = this.clients.get(sessionKey);
    
    if (session) {
      session.lastActive = Date.now();
    }
  }

  /**
   * Sends a message to an RTM channel
   */
  public async sendMessageToChannel(
    rtmClient: any, 
    channelName: string, 
    message: string
  ): Promise<boolean> {
    if (!rtmClient) {
      return false;
    }

    try {
      const payload = {
        type: "command",
        message
      };

      logRtm(`Sending command to channel ${channelName}:`, message);
      await rtmClient.publish(channelName, JSON.stringify(payload));
      logRtm(`Command sent successfully`);
      return true;
    } catch (error) {
      console.error('[RTM] Error sending message to channel:', error);
      return false;
    }
  }

  /**
   * Gets active client session information for debugging
   */
  public getActiveClients(): { appId: string, userId: string, channelName: string, lastActive: number }[] {
    return Array.from(this.clients.values()).map(session => ({
      appId: session.appId,
      userId: session.userId,
      channelName: session.channelName,
      lastActive: session.lastActive
    }));
  }

  public static getInstance(): RTMClientManager {
    if (!RTMClientManager.instance) {
      RTMClientManager.instance = new RTMClientManager();
    }
    return RTMClientManager.instance;
  }
}

// Create and export the singleton instance
const rtmClientManager = RTMClientManager.getInstance();
export default rtmClientManager;