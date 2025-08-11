// lib/common/conversation-store.ts
// Updated to store conversations by appId:userId:channel for proper isolation
// Now using proper logging system

import { CONFIG } from './cache';
import { conversationLogger as logger } from './logger';

// Define the interfaces - keep mode for internal tracking
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  mode?: 'chat' | 'voice' | 'video'; // INTERNAL ONLY - not sent to LLM
  timestamp?: number;
}

export interface Conversation {
  appId: string;
  userId: string;
  channel: string;
  messages: Message[];
  lastUpdated: number;
  rtmSystemMessage?: string;
  lastSystemMessageHash?: string;
}

// Configuration for memory management
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CONVERSATION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Tiered message limits based on conversation activity
const MESSAGE_LIMITS = {
  MAX_TOTAL_MESSAGES: 150,
  TARGET_MESSAGES: 100,
  CHAT_WINDOW_SIZE: 50,
  VOICE_VIDEO_WINDOW_SIZE: 30,
  MIN_MESSAGES_TO_KEEP: 20
};

// In-memory store - now properly keyed by appId:userId:channel
const conversationStore: Record<string, Conversation> = {};

/**
 * Creates a simple hash of a string for comparison
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

/**
 * Smart conversation trimming that preserves important messages
 */
function smartTrimConversation(conversation: Conversation): void {
  const messages = conversation.messages;
  
  if (messages.length <= MESSAGE_LIMITS.TARGET_MESSAGES) {
    return;
  }
  
  logger.info(`Trimming conversation`, {
    userId: conversation.userId,
    channel: conversation.channel,
    currentSize: messages.length,
    targetSize: MESSAGE_LIMITS.TARGET_MESSAGES
  });
  
  // Separate messages by type and importance
  const systemMessages = messages.filter(msg => msg.role === 'system');
  const chatMessages = messages
    .filter(msg => msg.mode === 'chat' && msg.role !== 'system')
    .slice(-MESSAGE_LIMITS.CHAT_WINDOW_SIZE);
  const voiceVideoMessages = messages
    .filter(msg => (msg.mode === 'voice' || msg.mode === 'video') && msg.role !== 'system')
    .slice(-MESSAGE_LIMITS.VOICE_VIDEO_WINDOW_SIZE);
  const toolMessages = messages.filter(msg => msg.role === 'tool');
  
  // Rebuild conversation with smart selection
  let keptMessages: Message[] = [];
  
  // Always keep the most recent system message
  if (systemMessages.length > 0) {
    keptMessages.push(systemMessages[systemMessages.length - 1]);
  }
  
  // Merge and sort recent messages by timestamp
  const recentMessages = [...chatMessages, ...voiceVideoMessages]
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  
  // Keep recent tool messages that correspond to recent assistant messages
  const recentMessageIds = new Set(
    recentMessages
      .filter(msg => msg.role === 'assistant' && msg.tool_calls)
      .flatMap(msg => msg.tool_calls?.map(tc => tc.id) || [])
  );
  
  const relevantToolMessages = toolMessages.filter(msg => 
    msg.tool_call_id && recentMessageIds.has(msg.tool_call_id)
  );
  
  // Combine all kept messages and sort by timestamp
  keptMessages = [...keptMessages, ...recentMessages, ...relevantToolMessages]
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  
  // Ensure we don't go below minimum
  if (keptMessages.length < MESSAGE_LIMITS.MIN_MESSAGES_TO_KEEP && messages.length > MESSAGE_LIMITS.MIN_MESSAGES_TO_KEEP) {
    const additionalNeeded = MESSAGE_LIMITS.MIN_MESSAGES_TO_KEEP - keptMessages.length;
    const additionalMessages = messages
      .filter(msg => !keptMessages.includes(msg))
      .slice(-additionalNeeded);
    keptMessages = [...keptMessages, ...additionalMessages]
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }
  
  conversation.messages = keptMessages;
  
  logger.debug(`Conversation trimmed`, {
    finalSize: keptMessages.length,
    system: systemMessages.length > 0 ? 1 : 0,
    chat: chatMessages.length,
    voiceVideo: voiceVideoMessages.length,
    tool: relevantToolMessages.length
  });
}

/**
 * Smart system message management based on mode
 */
function manageSystemMessage(conversation: Conversation, newSystemContent: string, messageMode: 'chat' | 'voice' | 'video' | undefined): void {
  const newSystemHash = simpleHash(newSystemContent);
  
  // Store original RTM system message if this is the first chat message
  if (messageMode === 'chat' && !conversation.rtmSystemMessage) {
    conversation.rtmSystemMessage = newSystemContent;
    conversation.lastSystemMessageHash = newSystemHash;
    logger.debug(`Stored original RTM system message`, {
      userId: conversation.userId,
      channel: conversation.channel
    });
  }
  
  // Check if system message actually changed
  if (conversation.lastSystemMessageHash === newSystemHash) {
    logger.trace(`System message unchanged, skipping duplicate`, {
      userId: conversation.userId,
      channel: conversation.channel
    });
    return;
  }
  
  // Remove old system messages
  conversation.messages = conversation.messages.filter(msg => msg.role !== 'system');
  
  // Add new system message
  conversation.messages.unshift({
    role: 'system',
    content: newSystemContent,
    timestamp: Date.now(),
    mode: messageMode
  });
  
  conversation.lastSystemMessageHash = newSystemHash;
  const modeType = messageMode === 'chat' ? 'RTM' : 'Endpoint';
  
  logger.debug(`Updated system message`, {
    userId: conversation.userId,
    channel: conversation.channel,
    type: modeType,
    mode: messageMode
  });
}

/**
 * Gets a unique key for the conversation based on appId, userId, and channel
 */
function getConversationKey(appId: string, userId: string, channel: string): string {
  return `${appId}:${userId}:${channel}`;
}

/**
 * Extract user ID from message content for display purposes
 */
function extractUserIdForDisplay(content: string): { userId?: string; cleanContent: string } {
  // Check for [userId] prefix pattern
  const match = content.match(/^\[([^\]]+)\]\s*(.*)/);
  if (match) {
    let userId = match[1];
    
    // If userId contains '-', split on last occurrence and use first part as display name
    const lastDashIndex = userId.lastIndexOf('-');
    if (lastDashIndex !== -1) {
      userId = userId.substring(0, lastDashIndex);
    }
    
    return {
      userId: userId,
      cleanContent: match[2]
    };
  }
  return {
    cleanContent: content
  };
}

/**
 * Logs conversation context with mode analysis and memory usage
 */
export function logConversationContext(
  appId: string, 
  userId: string,
  channel: string, 
  conversation: Conversation,
  action: 'retrieved' | 'created' | 'updated'
): void {
  if (!CONFIG.enableConversationLogging) return;

  const memoryEstimate = JSON.stringify(conversation).length;
  
  // Analyze message distribution by mode
  const messageStats = {
    system: 0,
    chat: 0,
    voice: 0,
    video: 0,
    tool: 0,
    unspecified: 0
  };
  
  conversation.messages.forEach(msg => {
    if (msg.role === 'system') messageStats.system++;
    else if (msg.role === 'tool') messageStats.tool++;
    else if (msg.mode === 'chat') messageStats.chat++;
    else if (msg.mode === 'voice') messageStats.voice++;
    else if (msg.mode === 'video') messageStats.video++;
    else messageStats.unspecified++;
  });
  
  logger.debug(`Conversation ${action}`, {
    userId,
    appId,
    channel,
    totalMessages: conversation.messages.length,
    memoryKB: (memoryEstimate / 1024).toFixed(2),
    distribution: messageStats,
    isHighMessageCount: conversation.messages.length > MESSAGE_LIMITS.TARGET_MESSAGES
  });
  
  // Show recent message sequence
  if (conversation.messages.length > 0) {
    const recentMessages = conversation.messages.slice(-3).map((msg, index) => {
      const actualIndex = conversation.messages.length - 3 + index;
      const { userId: extractedUserId, cleanContent } = extractUserIdForDisplay(msg.content || '');
      
      let summary = '';
      if (msg.role === 'user' && extractedUserId) {
        summary = `[${actualIndex}] user [${extractedUserId}]: ${cleanContent}`;
      } else {
        summary = `[${actualIndex}] ${msg.role}: ${msg.content || '[no content]'}`;
      }
      
      return summary.length > 80 ? summary.substring(0, 77) + '...' : summary;
    });
    
    logger.trace('Recent messages', recentMessages);
  }
}

/**
 * Detects potential mode transitions in conversation
 */
export function detectModeTransition(conversation: Conversation): {
  hasModeTransition: boolean;
  lastUserMode?: string;
  lastAssistantMode?: string;
  possibleHangup: boolean;
} {
  const messages = conversation.messages;
  if (messages.length < 2) {
    return { hasModeTransition: false, possibleHangup: false };
  }
  
  // Find last user and assistant messages with modes
  let lastUserMode: string | undefined;
  let lastAssistantMode: string | undefined;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' && msg.mode && !lastUserMode) {
      lastUserMode = msg.mode;
    } else if (msg.role === 'assistant' && msg.mode && !lastAssistantMode) {
      lastAssistantMode = msg.mode;
    }
    
    if (lastUserMode && lastAssistantMode) break;
  }
  
  // Check for mode transitions
  const hasModeTransition = lastUserMode !== lastAssistantMode;
  
  // Check for possible hangup (voice/video to chat transition)
  const possibleHangup = (lastAssistantMode === 'video' || lastAssistantMode === 'voice') && 
                         lastUserMode === 'chat';
  
  return {
    hasModeTransition,
    lastUserMode,
    lastAssistantMode,
    possibleHangup
  };
}

/**
 * Gets an existing conversation or creates a new one if it doesn't exist
 */
export async function getOrCreateConversation(appId: string, userId: string, channel: string = 'default'): Promise<Conversation> {
  const key = getConversationKey(appId, userId, channel);
  
  if (!conversationStore[key]) {
    logger.info(`Creating new conversation`, { userId, appId, channel });
    conversationStore[key] = {
      appId,
      userId,
      channel,
      messages: [],
      lastUpdated: Date.now()
    };
    
    logConversationContext(appId, userId, channel, conversationStore[key], 'created');
  } else {
    logger.trace(`Found existing conversation`, {
      userId,
      channel,
      messageCount: conversationStore[key].messages.length
    });
    logConversationContext(appId, userId, channel, conversationStore[key], 'retrieved');
  }
  
  return conversationStore[key];
}

/**
 * Simplified saveMessage with mode-based memory management
 */
export async function saveMessage(
  appId: string, 
  userId: string, 
  channel: string,
  message: Message
): Promise<void> {
  const conversation = await getOrCreateConversation(appId, userId, channel);
  
  // Handle system messages specially
  if (message.role === 'system') {
    manageSystemMessage(conversation, message.content, message.mode);
    conversation.lastUpdated = Date.now();
    
    logConversationContext(appId, userId, channel, conversation, 'updated');
    return;
  }
  
  // Enhanced message with metadata
  const enhancedMessage: Message = {
    ...message,
    timestamp: message.timestamp || Date.now()
  };
  
  // Add the new message
  conversation.messages.push(enhancedMessage);
  conversation.lastUpdated = Date.now();
  
  // Smart trimming if conversation is getting too large
  if (conversation.messages.length > MESSAGE_LIMITS.MAX_TOTAL_MESSAGES) {
    smartTrimConversation(conversation);
  }
  
  const modeInfo = enhancedMessage.mode ? ` [${enhancedMessage.mode}]` : '';
  const serviceInfo = enhancedMessage.mode === 'chat' ? ' (RTM)' : enhancedMessage.mode ? ' (Endpoint)' : '';
  
  logger.debug(`Saved message`, {
    role: message.role,
    mode: enhancedMessage.mode,
    service: serviceInfo.replace(/[() ]/g, ''),
    userId,
    channel,
    totalMessages: conversation.messages.length
  });
  
  logConversationContext(appId, userId, channel, conversation, 'updated');
}

/**
 * Enhanced cleanup with memory pressure detection
 */
export function cleanupOldConversations(maxAgeMs: number = MAX_CONVERSATION_AGE_MS): void {
  const now = Date.now();
  let removedCount = 0;
  let trimmedCount = 0;
  
  // Calculate total memory usage
  let totalMemoryEstimate = 0;
  const conversationSizes: Array<{key: string, size: number, age: number}> = [];
  
  Object.entries(conversationStore).forEach(([key, conversation]) => {
    const size = JSON.stringify(conversation).length;
    const age = now - conversation.lastUpdated;
    totalMemoryEstimate += size;
    conversationSizes.push({ key, size, age });
  });
  
  const totalMemoryMB = totalMemoryEstimate / 1024 / 1024;
  logger.info(`Memory usage check`, {
    totalMB: totalMemoryMB.toFixed(2),
    conversationCount: Object.keys(conversationStore).length
  });
  
  // Remove old conversations
  Object.keys(conversationStore).forEach(key => {
    const conversation = conversationStore[key];
    const age = now - conversation.lastUpdated;
    
    if (age > maxAgeMs) {
      logger.debug(`Removing old conversation`, {
        userId: conversation.userId,
        channel: conversation.channel,
        ageMinutes: Math.round(age/1000/60)
      });
      delete conversationStore[key];
      removedCount++;
    } else if (conversation.messages.length > MESSAGE_LIMITS.TARGET_MESSAGES) {
      smartTrimConversation(conversation);
      trimmedCount++;
    }
  });
  
  // Memory pressure cleanup
  const MAX_TOTAL_MEMORY_MB = 50;
  if (totalMemoryMB > MAX_TOTAL_MEMORY_MB) {
    logger.warn(`Memory pressure detected`, {
      currentMB: totalMemoryMB.toFixed(2),
      maxMB: MAX_TOTAL_MEMORY_MB
    });
    
    conversationSizes.sort((a, b) => b.size - a.size);
    
    let memoryFreed = 0;
    const targetToFree = totalMemoryEstimate - (MAX_TOTAL_MEMORY_MB * 0.8 * 1024 * 1024);
    
    for (const { key, size } of conversationSizes) {
      if (memoryFreed >= targetToFree) break;
      
      const conversation = conversationStore[key];
      logger.debug(`Removing large conversation`, {
        userId: conversation.userId,
        channel: conversation.channel,
        sizeKB: (size / 1024).toFixed(2)
      });
      delete conversationStore[key];
      memoryFreed += size;
      removedCount++;
    }
  }
  
  if (removedCount > 0 || trimmedCount > 0) {
    logger.info(`Cleanup complete`, { removed: removedCount, trimmed: trimmedCount });
  }
}

/**
 * Gets conversation statistics with memory analysis
 */
export function getConversationStats(): any {
  const totalConversations = Object.keys(conversationStore).length;
  let totalMessages = 0;
  let totalMemoryEstimate = 0;
  let oldestConversationAge = 0;
  const now = Date.now();
  
  const modeStats = {
    chat: 0,
    voice: 0,
    video: 0,
    unspecified: 0
  };
  
  // Channel-based statistics
  const channelStats: Record<string, number> = {};
  
  Object.values(conversationStore).forEach(convo => {
    totalMessages += convo.messages.length;
    totalMemoryEstimate += JSON.stringify(convo).length;
    
    // Track channel distribution
    channelStats[convo.channel] = (channelStats[convo.channel] || 0) + 1;
    
    const age = now - convo.lastUpdated;
    if (age > oldestConversationAge) {
      oldestConversationAge = age;
    }
    
    convo.messages.forEach(msg => {
      if (msg.mode === 'chat') modeStats.chat++;
      else if (msg.mode === 'voice') modeStats.voice++;
      else if (msg.mode === 'video') modeStats.video++;
      else modeStats.unspecified++;
    });
  });
  
  return {
    totalConversations,
    totalMessages,
    memoryUsageMB: (totalMemoryEstimate / 1024 / 1024).toFixed(2),
    oldestConversationAgeHours: oldestConversationAge / (60 * 60 * 1000),
    averageMessagesPerConversation: totalConversations ? totalMessages / totalConversations : 0,
    messagesByMode: modeStats,
    conversationsByChannel: channelStats,
    memoryLimits: MESSAGE_LIMITS
  };
}

/**
 * Clear all conversations (for testing/debugging)
 */
export async function clearAllConversations(): Promise<void> {
  Object.keys(conversationStore).forEach(key => {
    delete conversationStore[key];
  });
  logger.info('Cleared all conversations');
}

/**
 * Get conversations for a specific channel (useful for debugging)
 */
export function getConversationsForChannel(appId: string, channel: string): Conversation[] {
  return Object.values(conversationStore).filter(convo => 
    convo.appId === appId && convo.channel === channel
  );
}

/**
 * Get all channels for an app (useful for debugging)
 */
export function getChannelsForApp(appId: string): string[] {
  const channels = new Set<string>();
  Object.values(conversationStore).forEach(convo => {
    if (convo.appId === appId) {
      channels.add(convo.channel);
    }
  });
  return Array.from(channels);
}

// Enhanced cleanup interval
if (typeof window === 'undefined') {
  setInterval(() => {
    try {
      cleanupOldConversations();
    } catch (error) {
      logger.error('Error during cleanup', error);
    }
  }, CLEANUP_INTERVAL_MS);
  
  logger.info('Conversation store initialized', {
    keyFormat: 'appId:userId:channel',
    maxMessages: MESSAGE_LIMITS.MAX_TOTAL_MESSAGES,
    targetMessages: MESSAGE_LIMITS.TARGET_MESSAGES,
    cleanupIntervalMinutes: CLEANUP_INTERVAL_MS / (60 * 1000)
  });
}

export { smartTrimConversation, MESSAGE_LIMITS };