// lib/common/conversation-store.ts

// Define the interfaces
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
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
  } else {
    console.log(`[CONVERSATION] Found existing conversation for ${userId} with ${conversationStore[key].messages.length} messages`);
  }
  
  return conversationStore[key];
}

/**
 * Saves a message to the conversation
 */
export async function saveMessage(appId: string, userId: string, message: Message): Promise<void> {
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
  
  // Add the new message
  conversation.messages.push(message);
  conversation.lastUpdated = Date.now();
  
  console.log(`[CONVERSATION] Saved ${message.role} message for ${userId}. Conversation now has ${conversation.messages.length} messages`);
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
 * Gets conversation statistics
 */
export function getConversationStats(): any {
  const totalConversations = Object.keys(conversationStore).length;
  let totalMessages = 0;
  let oldestConversationAge = 0;
  const now = Date.now();
  
  Object.values(conversationStore).forEach(convo => {
    totalMessages += convo.messages.length;
    const age = now - convo.lastUpdated;
    if (age > oldestConversationAge) {
      oldestConversationAge = age;
    }
  });
  
  return {
    totalConversations,
    totalMessages,
    oldestConversationAgeHours: oldestConversationAge / (60 * 60 * 1000),
    averageMessagesPerConversation: totalConversations ? totalMessages / totalConversations : 0
  };
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
  
  console.log('[CONVERSATION] Conversation store initialized, cleanup scheduled every', 
    CLEANUP_INTERVAL_MS / (60 * 1000), 'minutes');
}
