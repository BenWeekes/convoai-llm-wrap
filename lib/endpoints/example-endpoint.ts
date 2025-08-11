// lib/endpoints/example-endpoint.ts
// Updated with proper logging system

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';
import { sendPhotoMessage } from '../common/messaging-utils';
import { toolLogger, createLogger } from '../common/logger';

const logger = createLogger('EXAMPLE-ENDPOINT');

// Define RAG data for this endpoint
const EXAMPLE_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform.",
  doc2: "Agora Convo AI comes out on March 1st for GA. It will be best in class for quality and reach",
  doc3: "Tony Wang is the best revenue officer.",
  doc4: "Hermes Frangoudis is the best developer."
};

// Simplified system message template - mode context is automatically added
function exampleSystemTemplate(ragData: Record<string, string>): string {
  // Get base prompt from environment variable
  const basePrompt = process.env.EXAMPLE_RTM_LLM_PROMPT || 
    'you are a friendly companion';

  return `
    ${basePrompt}

    CORE BEHAVIOR:
    - Be warm, engaging, and personable in your interactions
    - Respond naturally to user questions and requests
    - Use the knowledge provided to answer questions accurately
    
    PHOTO SENDING RULES - READ CAREFULLY:
    - ONLY use the send_photo tool when the user EXPLICITLY asks for a photo
    - Examples of explicit requests: "send me a photo", "can you send a pic", "show me a picture", "send photo please"
    - DO NOT send photos for: greetings, thanks, confirmations, casual conversation, or general compliments
    - DO NOT send photos when user says: "thanks", "that's right", "ok", "cool", "nice", etc.
    - If you already sent a photo in this conversation, wait for another explicit request
    - If user asks for multiple photos quickly, politely explain you prefer to send one at a time
    - Example responses when declining: "I'd love to send more photos! Just ask when you'd like to see another one 😊"
    
    You have access to the following knowledge:
    doc1: "${ragData.doc1}"
    doc2: "${ragData.doc2}"
    doc3: "${ragData.doc3}"
    doc4: "${ragData.doc4}"
    
    When you receive information from tools like order_sandwich or send_photo, 
    make sure to reference specific details from their responses in your replies.
    
    Answer questions using this data and be confident about its contents.
  `;
}

// Define the tools for this endpoint
const EXAMPLE_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "order_sandwich",
      description: "Place a sandwich order with a given filling. Logs the order to console and returns delivery details.",
      parameters: {
        type: "object",
        properties: {
          filling: {
            type: "string",
            description: "Type of filling (e.g. 'Turkey', 'Ham', 'Veggie')"
          }
        },
        required: ["filling"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_photo",
      description: "Request a photo be sent to the user.",
      parameters: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Type of photo subject (optional, e.g. 'face', 'full_body', 'landscape')"
          }
        },
        required: []
      }
    }
  }
];

// Available photo options for randomization
const PHOTO_OPTIONS = [
  "bella1.png"
];

// Enhanced photo rate limiting
const PHOTO_RATE_LIMIT_MS = 30000; // 30 seconds between photos

// Simple counter-based approach - tracks photo sends per user
const recentPhotoSends = new Map<string, number>();

// Cleanup timer to prevent memory leaks
let cleanupTimer: NodeJS.Timeout | null = null;

// Start cleanup timer on module load
function startPhotoCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const cutoff = now - (PHOTO_RATE_LIMIT_MS * 2);
    let cleanedCount = 0;
    
    const entries = Array.from(recentPhotoSends.entries());
    for (const [key, timestamp] of entries) {
      if (timestamp < cutoff) {
        recentPhotoSends.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`Cleaned up old photo send entries`, { count: cleanedCount });
    }
  }, 60000); // Run every minute
}

// Helper function to check recent photo sends
async function hasRecentPhotoSend(appId: string, userId: string, timeWindowMs: number): Promise<boolean> {
  try {
    const userKey = `${appId}:${userId}`;
    const now = Date.now();
    const lastPhotoTime = recentPhotoSends.get(userKey) || 0;
    const timeSinceLastPhoto = now - lastPhotoTime;
    
    logger.trace(`Checking recent photo sends`, {
      userKey,
      timeSinceLastPhoto,
      timeWindow: timeWindowMs
    });
    
    // Check timestamp-based rate limiting
    if (timeSinceLastPhoto < timeWindowMs) {
      const remainingTime = Math.ceil((timeWindowMs - timeSinceLastPhoto) / 1000);
      logger.debug(`Photo rate limited`, {
        timeSinceLastPhoto,
        remainingSeconds: remainingTime
      });
      return true;
    }
    
    logger.trace(`No recent photo activity`, {
      lastPhotoMs: timeSinceLastPhoto
    });
    return false;
  } catch (error) {
    logger.error('Error checking recent photo sends', error);
    return false; // Default to allowing if we can't check
  }
}

// Helper function to mark a photo as sent
function markPhotoSent(appId: string, userId: string): void {
  const userKey = `${appId}:${userId}`;
  const now = Date.now();
  recentPhotoSends.set(userKey, now);
  
  logger.debug(`Marked photo sent`, { userKey, timestamp: now });
}

// Implement the tool functions with enhanced logging
function order_sandwich(appId: string, userId: string, channel: string, args: any): string {
  const filling = args?.filling || "Unknown";
  
  toolLogger.info(`Sandwich order placed`, {
    appId,
    userId,
    channel,
    filling
  });
  
  const result = `Sandwich ordered with ${filling}. It will arrive at 3pm. Enjoy!`;
  
  toolLogger.debug(`Sandwich order result`, { result });
  
  return result;
}

async function send_photo(appId: string, userId: string, channel: string, args: any): Promise<string> {
  // Handle null/empty args safely
  const subject = args?.subject || "default";

  toolLogger.info(`Photo tool called`, {
    appId,
    userId,
    channel,
    subject
  });
  
  // Enhanced rate limiting check using timestamps only
  const hasRecentPhoto = await hasRecentPhotoSend(appId, userId, PHOTO_RATE_LIMIT_MS);
  
  if (hasRecentPhoto) {
    const cooldownMessage = `I just sent you a photo recently! Let's chat a bit more before I send another one 😊`;
    toolLogger.debug(`Photo rate limited`, { userId });
    return cooldownMessage;
  }
  
  // Check environment variables - for RTM chat, use the RTM-specific from user
  let fromUser = process.env.RTM_FROM_USER;
  
  if (!fromUser) {
    logger.error('RTM_FROM_USER environment variable is not set');
    return `Failed to send photo: Missing RTM_FROM_USER configuration.`;
  }
  
  if (!appId) {
    logger.error('appId is missing');
    return `Failed to send photo: Missing appId.`;
  }

  // Randomize photo selection from available options
  const randomIndex = Math.floor(Math.random() * PHOTO_OPTIONS.length);
  const selectedPhoto = PHOTO_OPTIONS[randomIndex];
  const imageUrl = `https://sa-utils.agora.io/mms/${selectedPhoto}`;
  
  toolLogger.debug(`Photo selected`, {
    photo: selectedPhoto,
    index: randomIndex + 1,
    total: PHOTO_OPTIONS.length,
    url: imageUrl
  });
  
  // Mark photo as sent BEFORE attempting to send (prevents race conditions)
  markPhotoSent(appId, userId);
  
  try {
    // Send photo with 3 second delay (non-blocking)
    const success = await sendPhotoMessage(
      appId, 
      fromUser, 
      userId,
      imageUrl,
      3000  // 3 second delay
    );
    
    let result: string;
    if (success) {
      result = `Sending you a photo! 📸 (${selectedPhoto.replace('.png', '').replace('april_', '').replace('_', ' ')}) - it'll arrive in a moment!`;
      toolLogger.info(`Photo sent successfully`, { userId, photo: selectedPhoto });
    } else {
      result = `We encountered an issue scheduling the photo. Please try again later.`;
      toolLogger.warn(`Photo send failed`, { userId });
    }
    
    return result;
  } catch (error) {
    toolLogger.error(`Photo tool error`, { userId, error });
    const errorResult = `Error sending photo: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return errorResult;
  }
}

// Create the tool map with debug wrappers
const EXAMPLE_TOOL_MAP = {
  order_sandwich: (appId: string, userId: string, channel: string, args: any) => {
    toolLogger.trace(`Tool map: order_sandwich wrapper called`, { channel });
    try {
      const result = order_sandwich(appId, userId, channel, args);
      toolLogger.trace(`Tool map: order_sandwich completed`);
      return result;
    } catch (error) {
      toolLogger.error(`Tool map: order_sandwich error`, error);
      throw error;
    }
  },
  send_photo: async (appId: string, userId: string, channel: string, args: any) => {
    toolLogger.trace(`Tool map: send_photo wrapper called`, { channel, args });
    try {
      const result = await send_photo(appId, userId, channel, args);
      toolLogger.trace(`Tool map: send_photo completed`);
      return result;
    } catch (error) {
      toolLogger.error(`Tool map: send_photo error`, error);
      throw error;
    }
  }
};

// Start cleanup timer on module load
startPhotoCleanupTimer();

// Debug logging at module load time
logger.info('Example endpoint initialized', {
  tools: Object.keys(EXAMPLE_TOOL_MAP),
  photoOptions: PHOTO_OPTIONS,
  photoRateLimitMs: PHOTO_RATE_LIMIT_MS
});

// Export the complete endpoint configuration with communication modes
export const exampleEndpointConfig: EndpointConfig = {
  ragData: EXAMPLE_RAG_DATA,
  tools: EXAMPLE_TOOLS,
  toolMap: EXAMPLE_TOOL_MAP,
  systemMessageTemplate: exampleSystemTemplate,
  communicationModes: {
    supportsChat: true,
    endpointMode: 'video',
    prependUserId: false,              // ❌ No user ID prefixing for this endpoint
    prependCommunicationMode: true     // ✅ Enable communication mode prefixing - instructions auto-generated
  }
};