// lib/common/conversation-store.ts
// Enhanced with communication mode support while preserving existing functionality
// Added configurable debug logging for conversation context

import { CONFIG } from './cache';

// Define the interfaces
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  mode?: 'chat' | 'voice' | 'video'; // NEW: Add mode support
  timestamp?: number; // NEW: Add timestamp support
}

export interface Conversation {
  appId: string;
  userId: string;
  messages: Message[];
  lastUpdated: number;
}

// Configuration
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CONVERSATION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MESSAGES_PER_CONVERSATION = 100; // Prevent memory issues

// In-memory store
const conversationStore: Record<string, Conversation> = {};

/**
 * Gets a unique key for the conversation based on appId and userId
 */
function getConversationKey(appId: string, userId: string): string {
  return `${appId}:${userId}`;
}

/**
 * Logs conversation context with mode analysis
 */
export function logConversationContext(
  appId: string, 
  userId: string, 
  conversation: Conversation,
  action: 'retrieved' | 'created' | 'updated'
): void {
  if (!CONFIG.enableConversationLogging) return;

  const separator = "💬".repeat(30);
  console.log(separator);
  console.log(`💬 CONVERSATION ${action.toUpperCase()} - ${new Date().toISOString()}`);
  console.log(`- User: ${userId}`);
  console.log(`- App: ${appId}`);
  console.log(`- Total Messages: ${conversation.messages.length}`);
  console.log(`- Last Updated: ${new Date(conversation.lastUpdated).toISOString()}`);
  
  // Analyze mode distribution in conversation
  const modeStats = {
    chat: 0,
    video: 0,
    voice: 0,
    unspecified: 0
  };
  
  let lastUserMode = 'unknown';
  let lastAssistantMode = 'unknown';
  
  conversation.messages.forEach((msg, index) => {
    if (msg.mode === 'chat') modeStats.chat++;
    else if (msg.mode === 'video') modeStats.video++;
    else if (msg.mode === 'voice') modeStats.voice++;
    else modeStats.unspecified++;
    
    // Track last modes by role
    if (msg.role === 'user' && msg.mode) {
      lastUserMode = msg.mode;
    } else if (msg.role === 'assistant' && msg.mode) {
      lastAssistantMode = msg.mode;
    }
  });
  
  console.log(`💬 MODE DISTRIBUTION:`);
  console.log(`  - Chat: ${modeStats.chat} messages`);
  console.log(`  - Video: ${modeStats.video} messages`);
  console.log(`  - Voice: ${modeStats.voice} messages`);
  console.log(`  - Unspecified: ${modeStats.unspecified} messages`);
  console.log(`💬 LAST MODES:`);
  console.log(`  - Last User Mode: ${lastUserMode}`);
  console.log(`  - Last Assistant Mode: ${lastAssistantMode}`);
  
  // Show recent message sequence with modes
  if (conversation.messages.length > 0) {
    console.log(`💬 RECENT MESSAGES (last 5):`);
    const recentMessages = conversation.messages.slice(-5);
    recentMessages.forEach((msg, index) => {
      const actualIndex = conversation.messages.length - 5 + index;
      const modeInfo = msg.mode ? ` [${msg.mode}]` : ' [no mode]';
      const preview = msg.content ? 
        (msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content) : 
        '[no content]';
      console.log(`  [${actualIndex}] ${msg.role}${modeInfo}: ${preview}`);
    });
  }
  
  // Detect potential mode transitions
  const transition = detectModeTransition(conversation);
  if (transition.hasModeTransition) {
    console.log(`💬 🚨 MODE TRANSITION DETECTED:`);
    console.log(`  - Last User Mode: ${transition.lastUserMode}`);
    console.log(`  - Last Assistant Mode: ${transition.lastAssistantMode}`);
    if (transition.possibleHangup) {
      console.log(`  - 🔥 POSSIBLE HANGUP: Video/Voice → Chat transition detected!`);
    }
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
  
  // Check for possible hangup (video/voice to chat transition)
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
export async function getOrCreateConversation(appId: string, userId: string): Promise<Conversation> {
  const key = getConversationKey(appId, userId);
  
  if (!conversationStore[key]) {
    console.log(`[CONVERSATION] Creating new conversation for ${userId} in app ${appId}`);
    // Create a new conversation
    conversationStore[key] = {
      appId,
      userId,
      messages: [],
      lastUpdated: Date.now()
    };
    
    // LOG NEW CONVERSATION CREATION
    logConversationContext(appId, userId, conversationStore[key], 'created');
  } else {
    console.log(`[CONVERSATION] Found existing conversation for ${userId} with ${conversationStore[key].messages.length} messages`);
    
    // LOG CONVERSATION RETRIEVAL
    logConversationContext(appId, userId, conversationStore[key], 'retrieved');
  }
  
  return conversationStore[key];
}

/**
 * Saves a message to the conversation - Enhanced with mode support
 */
export async function saveMessage(appId: string, userId: string, message: Message | {
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode?: 'chat' | 'voice' | 'video';
  timestamp?: number;
}): Promise<void> {
  const conversation = await getOrCreateConversation(appId, userId);
  
  // Trim conversation if it's getting too long
  if (conversation.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
    console.log(`[CONVERSATION] Trimming conversation for ${userId} (exceeded ${MAX_MESSAGES_PER_CONVERSATION} messages)`);
    
    // Keep system messages and the most recent messages
    const systemMessages = conversation.messages.filter(msg => msg.role === 'system');
    const nonSystemMessages = conversation.messages.filter(msg => msg.role !== 'system');
    
    // Keep the most recent messages
    const recentMessages = nonSystemMessages.slice(-Math.floor(MAX_MESSAGES_PER_CONVERSATION / 2));
    
    // Rebuild conversation with system messages and recent messages
    conversation.messages = [...systemMessages, ...recentMessages];
  }
  
  // Enhanced message with timestamp and mode support
  const enhancedMessage: Message = {
    ...message,
    timestamp: message.timestamp || Date.now()
  };
  
  // Only add mode if specified
  if ('mode' in message && message.mode) {
    enhancedMessage.mode = message.mode;
  }
  
  // Add the new message
  conversation.messages.push(enhancedMessage);
  conversation.lastUpdated = Date.now();
  
  const modeInfo = enhancedMessage.mode ? ` (${enhancedMessage.mode} mode)` : '';
  console.log(`[CONVERSATION] Saved ${message.role} message${modeInfo} for ${userId}. Conversation now has ${conversation.messages.length} messages`);
  
  // LOG CONVERSATION UPDATE WITH MODE CONTEXT
  logConversationContext(appId, userId, conversation, 'updated');
}

/**
 * Cleans up old conversations to prevent memory leaks
 */
export function cleanupOldConversations(maxAgeMs: number = MAX_CONVERSATION_AGE_MS): void {
  const now = Date.now();
  let removedCount = 0;
  
  Object.keys(conversationStore).forEach(key => {
    const conversation = conversationStore[key];
    if (now - conversation.lastUpdated > maxAgeMs) {
      delete conversationStore[key];
      removedCount++;
    }
  });
  
  if (removedCount > 0) {
    console.log(`[CONVERSATION] Cleaned up ${removedCount} old conversations`);
  }
}

/**
 * Gets all conversations (for debugging)
 */
export function getAllConversations(): Record<string, Conversation> {
  return { ...conversationStore };
}

/**
 * Gets conversation statistics - Enhanced with mode information
 */
export function getConversationStats(): any {
  const totalConversations = Object.keys(conversationStore).length;
  let totalMessages = 0;
  let oldestConversationAge = 0;
  const now = Date.now();
  
  // Track mode statistics
  const modeStats = {
    chat: 0,
    voice: 0,
    video: 0,
    unspecified: 0
  };
  
  Object.values(conversationStore).forEach(convo => {
    totalMessages += convo.messages.length;
    const age = now - convo.lastUpdated;
    if (age > oldestConversationAge) {
      oldestConversationAge = age;
    }
    
    // Count messages by mode
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
    oldestConversationAgeHours: oldestConversationAge / (60 * 60 * 1000),
    averageMessagesPerConversation: totalConversations ? totalMessages / totalConversations : 0,
    messagesByMode: modeStats
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

// Set up cleanup interval for old conversations
if (typeof window === 'undefined') { // Only run on server
  setInterval(() => {
    try {
      cleanupOldConversations();
    } catch (error) {
      console.error('[CONVERSATION] Error during cleanup:', error);
    }
  }, CLEANUP_INTERVAL_MS);
  
  console.log('[CONVERSATION] Conversation store initialized with mode support, cleanup scheduled every', 
    CLEANUP_INTERVAL_MS / (60 * 1000), 'minutes');
}