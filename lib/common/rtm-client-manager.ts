// lib/common/rtm-client-manager.ts
// Manages RTM client connections with PERSISTENT behavior (like old rtm-service.ts)
// FIXED: Added proper error handling and backoff strategy to prevent server crashes

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
  isReconnecting: boolean; // Prevent multiple simultaneous reconnection attempts
  lastReconnectAttempt: number; // Track last reconnection attempt time
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
  private maxReconnectAttempts: number = 10; // Limit reconnection attempts
  private reconnectBackoffMultiplier: number = 1.5; // Exponential backoff
  private maxReconnectDelay: number = 60000; // Max 1 minute between attempts
  
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
   * Calculate reconnection delay with exponential backoff
   */
  private getReconnectDelay(attempts: number): number {
    const baseDelay = this.reconnectTimeoutMs;
    const delay = Math.min(
      baseDelay * Math.pow(this.reconnectBackoffMultiplier, attempts - 1),
      this.maxReconnectDelay
    );
    return delay;
  }

  /**
   * Sets up message event listeners for an RTM client with proper error handling
   */
  private setupMessageListeners(rtmClient: any, appId: string, userId: string, channelName: string): void {
    const sessionKey = this.getSessionKey(appId, userId, channelName);
    
    // Add message event listener with error handling
    rtmClient.addEventListener("message", (event: any) => {
      try {
        const session = this.clients.get(sessionKey);
        if (session) {
          session.lastActive = Date.now();
          
          // Call all registered message handlers with error handling
          session.messageHandlers.forEach(handler => {
            try {
              handler(event);
            } catch (handlerError) {
              console.error('[RTM-PERSIST] Error in message handler:', handlerError);
              // Don't let handler errors crash the connection
            }
          });
        }
      } catch (error) {
        console.error('[RTM-PERSIST] Error processing received message:', error);
        // Continue running despite errors
      }
    });
    
    // Add presence event listener
    rtmClient.addEventListener("presence", (event: any) => {
      try {
        const session = this.clients.get(sessionKey);
        if (session) {
          session.lastActive = Date.now();
        }
        
        // Check for presence operation failures
        if (event.type === 'SNAPSHOT' && event.snapshot) {
          logRtm(`Presence snapshot received for ${userId}`);
        }
      } catch (error) {
        console.error('[RTM-PERSIST] Error handling presence event:', error);
      }
    });
    
    // Add status event listener with improved reconnection logic
    rtmClient.addEventListener("status", (event: any) => {
      logRtm(`Status: ${event.state} for ${userId}`);
      
      const session = this.clients.get(sessionKey);
      if (session) {
        session.lastActive = Date.now();
        
        // Handle connection states with backoff
        if (event.state === 'DISCONNECTED' || event.state === 'FAILED') {
          if (!session.isReconnecting) {
            logRtm(`Connection issue for ${userId}, initiating reconnection with backoff...`);
            this.scheduleReconnection(session, sessionKey);
          }
        } else if (event.state === 'RECONNECTING') {
          session.isReconnecting = true;
          logRtm(`${userId} is reconnecting...`);
        } else if (event.state === 'CONNECTED') {
          session.reconnectAttempts = 0;
          session.isReconnecting = false;
          logRtm(`${userId} connected successfully`);
        }
      }
    });

    // Add error event listener - handle errors gracefully
    rtmClient.addEventListener("error", (error: any) => {
      console.error(`[RTM-PERSIST] RTM error for ${userId}:`, error);
      
      const session = this.clients.get(sessionKey);
      if (session) {
        session.lastActive = Date.now();
        
        // Handle specific error codes
        if (error.code === -13013) {
          logRtm(`Presence operation failed for ${userId} - this is often temporary`);
          // Don't immediately reconnect for presence errors
        } else if (error.message?.includes('Kicked off by remote session')) {
          logRtm(`${userId} was kicked off - likely logged in elsewhere`);
          // Schedule reconnection with longer delay
          if (!session.isReconnecting) {
            setTimeout(() => this.scheduleReconnection(session, sessionKey), 10000);
          }
        }
      }
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnection(session: RTMClientSession, sessionKey: string): void {
    if (session.isReconnecting) {
      logRtm(`Already reconnecting ${session.userId}, skipping duplicate attempt`);
      return;
    }

    session.isReconnecting = true;
    session.reconnectAttempts++;

    if (session.reconnectAttempts > this.maxReconnectAttempts) {
      logRtm(`Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${session.userId}`);
      session.isReconnecting = false;
      // Could implement a longer backoff or manual reconnection strategy here
      return;
    }

    const delay = this.getReconnectDelay(session.reconnectAttempts);
    logRtm(`Scheduling reconnection for ${session.userId} (attempt ${session.reconnectAttempts}) in ${delay}ms`);

    setTimeout(() => {
      this.attemptReconnection(session, sessionKey);
    }, delay);
  }

  /**
   * Attempt reconnection with proper error handling
   */
  private async attemptReconnection(session: RTMClientSession, sessionKey: string): Promise<void> {
    try {
      logRtm(`Attempting reconnection for ${session.userId} (attempt ${session.reconnectAttempts})`);
      session.lastReconnectAttempt = Date.now();

      // Try to logout existing client first (ignore errors)
      try {
        if (session.rtmClient) {
          await session.rtmClient.logout();
        }
      } catch (logoutError) {
        // Ignore logout errors
      }

      // Create new client
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
        session.isReconnecting = false;
        session.reconnectAttempts = 0;
        
        // Set up listeners for the new client
        this.setupMessageListeners(newRtmClient, session.appId, session.userId, session.channelName);
        
        logRtm(`Successfully reconnected ${session.userId}`);
      } else {
        throw new Error('Failed to create new RTM client');
      }
    } catch (error) {
      console.error(`[RTM-PERSIST] Reconnection failed for ${session.userId}:`, error);
      session.isReconnecting = false;
      
      // Schedule next attempt if under max attempts
      if (session.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnection(session, sessionKey);
      }
    }
  }

  /**
   * Create a new RTM client instance with error handling
   */
  private async createRtmClient(appId: string, userId: string, token: string, channelName: string): Promise<any | null> {
    try {
      logRtm(`Creating RTM client for ${userId} in channel ${channelName}`);
      
      const rtmClient: any = new (AgoraRTM.RTM)(appId, userId);
      
      const loginOptions = token ? { token } : {};
      
      // Login with timeout
      await Promise.race([
        rtmClient.login(loginOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Login timeout')), 30000)
        )
      ]);
      
      logRtm(`Logged in as ${userId}`);

      // Subscribe with timeout
      await Promise.race([
        rtmClient.subscribe(channelName),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Subscribe timeout')), 30000)
        )
      ]);
      
      logRtm(`Subscribed to channel: ${channelName}`);
      
      return rtmClient;
    } catch (error: any) {
      console.error('[RTM-PERSIST] Error creating RTM client:', error);
      
      // Handle specific error types
      if (error.message?.includes('timeout')) {
        logRtm(`Timeout creating client for ${userId} - network may be slow`);
      } else if (error.code === -13013) {
        logRtm(`Presence operation failed for ${userId} - may need to wait before retry`);
      }
      
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
      const uptime = Math.round((Date.now() - session.lastActive) / 1000 / 60);
      logRtm(`Reusing PERSISTENT RTM client for ${userId} (uptime: ${uptime} minutes)`);
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
        isPersistent: true, // NEVER auto-cleanup
        isReconnecting: false,
        lastReconnectAttempt: 0
      };
      
      this.clients.set(sessionKey, session);
      this.setupMessageListeners(rtmClient, appId, userId, channelName);

      logRtm(`PERSISTENT RTM client created for ${userId} (will stay online with auto-reconnect)`);
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
   * Sends a message to an RTM channel with error handling
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
    } catch (error: any) {
      console.error('[RTM-PERSIST] Error sending message:', error);
      
      // Check for specific errors that might need reconnection
      if (error.code === -13013 || error.message?.includes('not logged in')) {
        logRtm('Send failed due to connection issue - reconnection may be needed');
      }
      
      return false;
    }
  }

  /**
   * Gets active client session information for debugging
   */
  public getActiveClients(): { 
    appId: string, 
    userId: string, 
    channelName: string, 
    lastActive: number, 
    isPersistent: boolean, 
    reconnectAttempts: number,
    isReconnecting: boolean 
  }[] {
    return Array.from(this.clients.values()).map(session => ({
      appId: session.appId,
      userId: session.userId,
      channelName: session.channelName,
      lastActive: session.lastActive,
      isPersistent: session.isPersistent,
      reconnectAttempts: session.reconnectAttempts,
      isReconnecting: session.isReconnecting
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
      
      // Mark as not reconnecting
      session.isReconnecting = false;
      session.reconnectAttempts = this.maxReconnectAttempts + 1; // Prevent auto-reconnect
      
      // Try to logout
      if (session.rtmClient) {
        await session.rtmClient.logout();
      }
      
      this.clients.delete(sessionKey);
      logRtm(`Successfully disconnected ${userId}`);
      return true;
    } catch (error) {
      console.error(`[RTM-PERSIST] Error disconnecting ${userId}:`, error);
      // Still remove from clients even if logout fails
      this.clients.delete(sessionKey);
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