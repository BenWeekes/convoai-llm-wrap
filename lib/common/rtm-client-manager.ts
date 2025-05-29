// lib/common/rtm-client-manager.ts
// Manages RTM client connections with PERSISTENT behavior (like old rtm-service.ts)

import AgoraRTM from 'rtm-nodejs';

// RTM session information
export interface RTMClientSession {
  rtmClient: any;
  lastActive: number;
  channelName: string;
  userId: string;
  appId: string;
  token: string;
  messageHandlers: RTMMessageHandler[];
  reconnectAttempts: number;
  isPersistent: boolean; // Never auto-cleanup if true
}

// Message handler type - receives full RTM event
export type RTMMessageHandler = (event: any) => void;

export type RTMClientParams = {
  enable_rtm?: boolean;
  agent_rtm_uid?: string;
  agent_rtm_token?: string;
  agent_rtm_channel?: string;
  appId: string;
}

// Simplified logging function
function logRtm(message: string, ...args: any[]) {
  console.log(`[RTM-PERSIST] ${message}`, ...args);
}

// Client manager that maintains PERSISTENT RTM connections (like old rtm-service.ts)
class RTMClientManager {
  private static instance: RTMClientManager;
  private clients: Map<string, RTMClientSession> = new Map();
  private reconnectTimeoutMs: number = 5000;
  private maxReconnectAttempts: number = 999; // Essentially infinite
  
  // NO CLEANUP TIMER - connections persist forever like rtm-service.ts

  constructor() {
    logRtm("RTM Client Manager initialized with PERSISTENT connections (no auto-cleanup)");
  }

  /**
   * Generate a unique session key for an RTM client
   */
  private getSessionKey(appId: string, userId: string, channelName: string): string {
    return `${appId}:${userId}:${channelName}`;
  }

  /**
   * Sets up message event listeners for an RTM client with aggressive reconnection
   */
  private setupMessageListeners(rtmClient: any, appId: string, userId: string, channelName: string): void {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    
    // Add message event listener
    rtmClient.addEventListener("message", (event: any) => {
      try {
        const session = this.clients.get(sessionKey);
        if (session) {
          session.lastActive = Date.now();
          
          // Call all registered message handlers
          session.messageHandlers.forEach(handler => {
            try {
              handler(event);
            } catch (handlerError) {
              console.error('[RTM-PERSIST] Error in message handler:', handlerError);
            }
          });
        }
      } catch (error) {
        console.error('[RTM-PERSIST] Error processing received message:', error);
      }
    });
    
    // Add presence event listener
    rtmClient.addEventListener("presence", (event: any) => {
      const session = this.clients.get(sessionKey);
      if (session) {
        session.lastActive = Date.now();
      }
    });
    
    // Add status event listener with AGGRESSIVE reconnection (like rtm-service.ts)
    rtmClient.addEventListener("status", (event: any) => {
      logRtm(`Status: ${event.state} for ${userId}`);
      
      const session = this.clients.get(sessionKey);
      if (session) {
        session.lastActive = Date.now();
        
        // Immediately attempt reconnection on ANY disconnect (like rtm-service.ts)
        if (event.state === 'DISCONNECTED' || event.state === 'FAILED' || event.state === 'RECONNECTING') {
          logRtm(`Connection issue for ${userId}, reconnecting immediately...`);
          this.immediateReconnection(session, sessionKey);
        } else if (event.state === 'CONNECTED') {
          session.reconnectAttempts = 0;
          logRtm(`${userId} connected successfully`);
        }
      }
    });

    // Add error event listener - DON'T disconnect on errors
    rtmClient.addEventListener("error", (error: any) => {
      console.error(`[RTM-PERSIST] RTM error for ${userId} (continuing connection):`, error);
      const session = this.clients.get(sessionKey);
      if (session) {
        session.lastActive = Date.now();
        // Don't reconnect on errors, just log them
      }
    });
  }

  /**
   * Immediate reconnection attempt (aggressive like rtm-service.ts)
   */
  private async immediateReconnection(session: RTMClientSession, sessionKey: string): Promise<void> {
    // Unlike the old version, we don't give up - keep trying forever
    session.reconnectAttempts++;
    logRtm(`Reconnecting ${session.userId} (attempt ${session.reconnectAttempts})`);

    try {
      const newRtmClient = await this.createRtmClient(
        session.appId,
        session.userId,
        session.token,
        session.channelName
      );

      if (newRtmClient) {
        // Replace the old client
        session.rtmClient = newRtmClient;
        session.lastActive = Date.now();
        
        // Set up listeners for the new client
        this.setupMessageListeners(newRtmClient, session.appId, session.userId, session.channelName);
        
        logRtm(`Successfully reconnected ${session.userId}`);
        session.reconnectAttempts = 0;
      } else {
        // Failed to reconnect, try again after delay
        setTimeout(() => {
          this.immediateReconnection(session, sessionKey);
        }, this.reconnectTimeoutMs);
      }
    } catch (error) {
      console.error(`[RTM-PERSIST] Reconnection failed for ${session.userId}:`, error);
      // Try again after delay
      setTimeout(() => {
        this.immediateReconnection(session, sessionKey);
      }, this.reconnectTimeoutMs);
    }
  }

  /**
   * Create a new RTM client instance
   */
  private async createRtmClient(appId: string, userId: string, token: string, channelName: string): Promise<any | null> {
    try {
      logRtm(`Creating RTM client for ${userId} in channel ${channelName}`);
      
      const rtmClient: any = new (AgoraRTM.RTM)(appId, userId);
      
      const loginOptions = token ? { token } : {};
      
      await rtmClient.login(loginOptions);
      logRtm(`Logged in as ${userId}`);

      await rtmClient.subscribe(channelName);
      logRtm(`Subscribed to channel: ${channelName}`);
      
      return rtmClient;
    } catch (error) {
      console.error('[RTM-PERSIST] Error creating RTM client:', error);
      return null;
    }
  }

  /**
   * Gets an RTM client, creating a PERSISTENT one if necessary (like rtm-service.ts)
   */
  public async getOrCreateClient(params: RTMClientParams): Promise<any | null> {
    if (!params.enable_rtm || !params.agent_rtm_uid || !params.agent_rtm_channel || !params.appId) {
      return null;
    }

    const appId = params.appId;
    const userId = params.agent_rtm_uid;
    const token = params.agent_rtm_token || '';
    const channelName = params.agent_rtm_channel;
    const sessionKey = this.getSessionKey(appId, userId, channelName);

    // Check if we already have a client (reuse forever like rtm-service.ts)
    if (this.clients.has(sessionKey)) {
      const session = this.clients.get(sessionKey)!;
      session.lastActive = Date.now();
      logRtm(`Reusing PERSISTENT RTM client for ${userId} (active for ${Math.round((Date.now() - session.lastActive)/1000/60)} minutes)`);
      return session.rtmClient;
    }

    try {
      const rtmClient = await this.createRtmClient(appId, userId, token, channelName);
      
      if (!rtmClient) {
        return null;
      }

      // Create PERSISTENT session (never auto-cleanup)
      const session: RTMClientSession = {
        rtmClient,
        lastActive: Date.now(),
        channelName,
        userId,
        appId,
        token,
        messageHandlers: [],
        reconnectAttempts: 0,
        isPersistent: true // NEVER auto-cleanup
      };
      
      this.clients.set(sessionKey, session);
      this.setupMessageListeners(rtmClient, appId, userId, channelName);

      logRtm(`PERSISTENT RTM client created for ${userId} (will stay online indefinitely)`);
      return rtmClient;
    } catch (error) {
      console.error('[RTM-PERSIST] Error creating persistent RTM client:', error);
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
      console.error(`[RTM-PERSIST] Cannot add message handler: No session for ${userId}`);
      return false;
    }
    
    session.messageHandlers.push(handler);
    session.lastActive = Date.now();
    logRtm(`Added message handler for PERSISTENT session ${userId} (total: ${session.messageHandlers.length})`);
    return true;
  }

  /**
   * Updates the last active timestamp (but connection stays persistent)
   */
  public updateLastActive(appId: string, userId: string, channelName: string): void {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    const session = this.clients.get(sessionKey);
    
    if (session) {
      session.lastActive = Date.now();
      // No cleanup logic - session stays alive indefinitely
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
      await rtmClient.publish(channelName, message);
      
      // Update activity for all sessions using this client
      this.clients.forEach(session => {
        if (session.rtmClient === rtmClient) {
          session.lastActive = Date.now();
        }
      });
      
      return true;
    } catch (error) {
      console.error('[RTM-PERSIST] Error sending message:', error);
      return false;
    }
  }

  /**
   * Gets active client session information for debugging
   */
  public getActiveClients(): { appId: string, userId: string, channelName: string, lastActive: number, isPersistent: boolean, reconnectAttempts: number }[] {
    return Array.from(this.clients.values()).map(session => ({
      appId: session.appId,
      userId: session.userId,
      channelName: session.channelName,
      lastActive: session.lastActive,
      isPersistent: session.isPersistent,
      reconnectAttempts: session.reconnectAttempts
    }));
  }

  /**
   * Manually disconnect a specific session (explicit logout like rtm-service.ts)
   */
  public async disconnectSession(appId: string, userId: string, channelName: string): Promise<boolean> {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    const session = this.clients.get(sessionKey);
    
    if (!session) {
      return false;
    }

    try {
      logRtm(`Manually disconnecting PERSISTENT session for ${userId}`);
      await session.rtmClient.logout();
      this.clients.delete(sessionKey);
      logRtm(`Successfully disconnected ${userId}`);
      return true;
    } catch (error) {
      console.error(`[RTM-PERSIST] Error disconnecting ${userId}:`, error);
      return false;
    }
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