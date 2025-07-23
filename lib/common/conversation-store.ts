// lib/common/conversation-store.ts
// Updated to store conversations by appId:userId:channel for proper isolation
// Fixed to include channel in conversation key for group call support

import { CONFIG } from './cache';

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
  channel: string; // ADDED: Track channel for proper isolation
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
  
  console.log(`[CONVERSATION] Trimming conversation for ${conversation.userId} in channel ${conversation.channel} (${messages.length} → target: ${MESSAGE_LIMITS.TARGET_MESSAGES})`);
  
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
  
  console.log(`[CONVERSATION] Trimmed to ${keptMessages.length} messages`);
  console.log(`[CONVERSATION] Kept: ${systemMessages.length > 0 ? 1 : 0} system, ${chatMessages.length} chat, ${voiceVideoMessages.length} voice/video, ${relevantToolMessages.length} tool`);
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
    console.log(`[CONVERSATION] Stored original RTM system message for ${conversation.userId} in channel ${conversation.channel}`);
  }
  
  // Check if system message actually changed
  if (conversation.lastSystemMessageHash === newSystemHash) {
    console.log(`[CONVERSATION] System message unchanged for ${conversation.userId} in channel ${conversation.channel}, skipping duplicate`);
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
  console.log(`[CONVERSATION] Updated system message for ${conversation.userId} in channel ${conversation.channel} (${modeType}: ${messageMode})`);
}

/**
 * Gets a unique key for the conversation based on appId, userId, and channel
 * UPDATED: Now includes channel for proper conversation isolation
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

  const separator = "💬".repeat(30);
  console.log(separator);
  console.log(`💬 CONVERSATION ${action.toUpperCase()} - ${new Date().toISOString()}`);
  console.log(`- User: ${userId}`);
  console.log(`- App: ${appId}`);
  console.log(`- Channel: ${channel}`); // ADDED: Log channel for clarity
  console.log(`- Total Messages: ${conversation.messages.length}`);
  console.log(`- Last Updated: ${new Date(conversation.lastUpdated).toISOString()}`);
  
  // Memory usage analysis
  const memoryEstimate = JSON.stringify(conversation).length;
  console.log(`- Memory Estimate: ${(memoryEstimate / 1024).toFixed(2)} KB`);
  
  if (conversation.messages.length > MESSAGE_LIMITS.TARGET_MESSAGES) {
    console.log(`- ⚠️  HIGH MESSAGE COUNT: ${conversation.messages.length}/${MESSAGE_LIMITS.MAX_TOTAL_MESSAGES} (trimming needed)`);
  }
  
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
  
  console.log(`💬 MESSAGE DISTRIBUTION:`);
  console.log(`  - System: ${messageStats.system}`);
  console.log(`  - Chat (RTM): ${messageStats.chat}`);
  console.log(`  - Video (Endpoint): ${messageStats.video}`);
  console.log(`  - Voice (Endpoint): ${messageStats.voice}`);
  console.log(`  - Tool: ${messageStats.tool}`);
  console.log(`  - Unspecified: ${messageStats.unspecified}`);
  
  // Show recent message sequence - FIXED FORMAT
  if (conversation.messages.length > 0) {
    console.log(`💬 RECENT MESSAGES (last 3):`);
    const recentMessages = conversation.messages.slice(-3);
    recentMessages.forEach((msg, index) => {
      const actualIndex = conversation.messages.length - 3 + index;
      
      // Extract user ID from content if present
      const { userId: extractedUserId, cleanContent } = extractUserIdForDisplay(msg.content || '');
      
      // Format the message properly
      let formattedMessage = '';
      if (msg.role === 'user' && extractedUserId) {
        // For user messages with ID prefix, show as: user [userId]: content
        formattedMessage = `  [${actualIndex}] ${msg.role} [${extractedUserId}]: ${cleanContent}`;
      } else {
        // For other messages, show as: role: content
        formattedMessage = `  [${actualIndex}] ${msg.role}: ${msg.content || '[no content]'}`;
      }
      
      // Truncate long messages
      if (formattedMessage.length > 80) {
        formattedMessage = formattedMessage.substring(0, 77) + '...';
      }
      
      console.log(formattedMessage);
    });
  }
  
  console.log(separator);
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
 * UPDATED: Now requires channel parameter for proper conversation isolation
 */
export async function getOrCreateConversation(appId: string, userId: string, channel: string = 'default'): Promise<Conversation> {
  const key = getConversationKey(appId, userId, channel);
  
  if (!conversationStore[key]) {
    console.log(`[CONVERSATION] Creating new conversation for ${userId} in app ${appId}, channel ${channel}`);
    conversationStore[key] = {
      appId,
      userId,
      channel, // ADDED: Store channel in conversation object
      messages: [],
      lastUpdated: Date.now()
    };
    
    logConversationContext(appId, userId, channel, conversationStore[key], 'created');
  } else {
    console.log(`[CONVERSATION] Found existing conversation for ${userId} in channel ${channel} with ${conversationStore[key].messages.length} messages`);
    logConversationContext(appId, userId, channel, conversationStore[key], 'retrieved');
  }
  
  return conversationStore[key];
}

/**
 * Simplified saveMessage with mode-based memory management
 * Mode is stored internally but not sent to LLM
 * UPDATED: Now requires channel parameter
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
  console.log(`[CONVERSATION] Saved ${message.role} message${modeInfo}${serviceInfo} for ${userId} in channel ${channel}. Conversation now has ${conversation.messages.length} messages`);
  
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
  
  console.log(`[CONVERSATION] Memory usage: ${(totalMemoryEstimate / 1024 / 1024).toFixed(2)} MB across ${Object.keys(conversationStore).length} conversations`);
  
  // Remove old conversations
  Object.keys(conversationStore).forEach(key => {
    const conversation = conversationStore[key];
    const age = now - conversation.lastUpdated;
    
    if (age > maxAgeMs) {
      console.log(`[CONVERSATION] Removing old conversation: ${conversation.userId} in channel ${conversation.channel} (age: ${Math.round(age/1000/60)} minutes)`);
      delete conversationStore[key];
      removedCount++;
    } else if (conversation.messages.length > MESSAGE_LIMITS.TARGET_MESSAGES) {
      smartTrimConversation(conversation);
      trimmedCount++;
    }
  });
  
  // Memory pressure cleanup
  const MAX_TOTAL_MEMORY_MB = 50;
  if (totalMemoryEstimate > MAX_TOTAL_MEMORY_MB * 1024 * 1024) {
    console.log(`[CONVERSATION] Memory pressure detected (${(totalMemoryEstimate / 1024 / 1024).toFixed(2)} MB), removing largest conversations`);
    
    conversationSizes.sort((a, b) => b.size - a.size);
    
    let memoryFreed = 0;
    const targetToFree = totalMemoryEstimate - (MAX_TOTAL_MEMORY_MB * 0.8 * 1024 * 1024);
    
    for (const { key, size } of conversationSizes) {
      if (memoryFreed >= targetToFree) break;
      
      const conversation = conversationStore[key];
      console.log(`[CONVERSATION] Removing large conversation ${conversation.userId} in channel ${conversation.channel} (${(size / 1024).toFixed(2)} KB)`);
      delete conversationStore[key];
      memoryFreed += size;
      removedCount++;
    }
  }
  
  if (removedCount > 0 || trimmedCount > 0) {
    console.log(`[CONVERSATION] Cleanup complete: ${removedCount} removed, ${trimmedCount} trimmed`);
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
    conversationsByChannel: channelStats, // ADDED: Channel-based statistics
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
  console.log('[CONVERSATION] Cleared all conversations');
}

/**
 * ADDED: Get conversations for a specific channel (useful for debugging)
 */
export function getConversationsForChannel(appId: string, channel: string): Conversation[] {
  return Object.values(conversationStore).filter(convo => 
    convo.appId === appId && convo.channel === channel
  );
}

/**
 * ADDED: Get all channels for an app (useful for debugging)
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
      console.error('[CONVERSATION] Error during cleanup:', error);
    }
  }, CLEANUP_INTERVAL_MS);
  
  console.log('[CONVERSATION] Conversation store initialized with channel-based memory management');
  console.log(`[CONVERSATION] Key format: appId:userId:channel for proper conversation isolation`);
  console.log(`[CONVERSATION] Limits: ${MESSAGE_LIMITS.MAX_TOTAL_MESSAGES} max messages, ${MESSAGE_LIMITS.TARGET_MESSAGES} target, cleanup every ${CLEANUP_INTERVAL_MS / (60 * 1000)} minutes`);
}

export { smartTrimConversation, MESSAGE_LIMITS };