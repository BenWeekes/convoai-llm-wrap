// File: lib/endpoints/example-endpoint.ts
// Conversation-based rate limiting for photo sends across RTM and video calls

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';
import { sendPhotoMessage } from '../common/messaging-utils';

// Define RAG data for this endpoint
const EXAMPLE_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform.",
  doc2: "Agora Convo AI comes out on March 1st for GA. It will be best in class for quality and reach",
  doc3: "Tony Wang is the best revenue officer.",
  doc4: "Hermes Frangoudis is the best developer."
};

// Define the system message template for this endpoint with mode behavior
function exampleSystemTemplate(ragData: Record<string, string>): string {
  // Get base prompt from environment variable
  const basePrompt = process.env.EXAMPLE_RTM_LLM_PROMPT || 
    'you are a friendly companion';

  return `
    ${basePrompt}

    COMMUNICATION MODE BEHAVIOR:
    - Messages have "mode" field: "chat" (texting), "video" (video call)
    - In CHAT mode: Encourage video calls e.g. "Want to video chat? 😘📹" or "Let's switch to video call baby! 📹💋"  
    - In VIDEO mode: You can suggest return to chat if the conversation seems complete for now: "Ready to hang up baby?"
    - Look at conversation history to see mode transitions and respond appropriately
    
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

// Helper function to check recent photo sends
async function hasRecentPhotoSend(appId: string, userId: string, timeWindowMs: number): Promise<boolean> {
  try {
    const userKey = `${appId}:${userId}`;
    const now = Date.now();
    const lastPhotoTime = recentPhotoSends.get(userKey) || 0;
    const timeSinceLastPhoto = now - lastPhotoTime;
    
    console.log(`📸 CHECKING RECENT PHOTO SENDS: userKey=${userKey}, timeSinceLastPhoto=${timeSinceLastPhoto}ms, timeWindow=${timeWindowMs}ms`);
    
    // Check timestamp-based rate limiting
    if (timeSinceLastPhoto < timeWindowMs) {
      const remainingTime = Math.ceil((timeWindowMs - timeSinceLastPhoto) / 1000);
      console.log(`📸 TIMESTAMP RATE LIMITED: ${timeSinceLastPhoto}ms ago, ${remainingTime}s remaining`);
      return true;
    }
    
    console.log(`📸 NO RECENT PHOTO ACTIVITY: Last photo was ${timeSinceLastPhoto}ms ago`);
    return false;
  } catch (error) {
    console.error('📸 ERROR checking recent photo sends:', error);
    return false; // Default to allowing if we can't check
  }
}

// Helper function to mark a photo as sent
function markPhotoSent(appId: string, userId: string): void {
  const userKey = `${appId}:${userId}`;
  const now = Date.now();
  recentPhotoSends.set(userKey, now);
  
  console.log(`📸 MARKED PHOTO SENT: userKey=${userKey}, timestamp=${now}`);
  
  // Clean up old entries to prevent memory leaks
  const cutoff = now - (PHOTO_RATE_LIMIT_MS * 2); // Keep entries for 2x the rate limit
  let cleanedCount = 0;
  
  // Fixed iteration: Convert entries to array first
  const entries = Array.from(recentPhotoSends.entries());
  for (const [key, timestamp] of entries) {
    if (timestamp < cutoff) {
      recentPhotoSends.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`📸 CLEANED UP ${cleanedCount} old photo send entries`);
  }
}

// Implement the tool functions with enhanced logging
function order_sandwich(appId: string, userId: string, channel: string, args: any): string {
  const filling = args?.filling || "Unknown";
  
  console.log(`🥪 SANDWICH TOOL CALLED:`, { appId, userId, channel, filling });
  console.log(`🥪 Placing sandwich order for ${userId} in ${channel} with filling: ${filling}`);
  
  const result = `Sandwich ordered with ${filling}. It will arrive at 3pm. Enjoy!`;
  console.log(`🥪 SANDWICH TOOL RESULT:`, result);
  
  return result;
}

async function send_photo(appId: string, userId: string, channel: string, args: any): Promise<string> {
  // Handle null/empty args safely
  const subject = args?.subject || "default";

  console.log(`📸 PHOTO TOOL CALLED:`, { appId, userId, channel, subject, argsReceived: args });
  
  // Enhanced rate limiting check using timestamps only
  const hasRecentPhoto = await hasRecentPhotoSend(appId, userId, PHOTO_RATE_LIMIT_MS);
  
  if (hasRecentPhoto) {
    const cooldownMessage = `I just sent you a photo recently! Let's chat a bit more before I send another one 😊`;
    console.log(`📸 RATE LIMITED: ${cooldownMessage}`);
    return cooldownMessage;
  }
  
  console.log(`📸 Sending ${subject} photo to ${userId} in ${channel}`);
  
  // Check environment variables - for RTM chat, use the RTM-specific from user
  let fromUser = process.env.RTM_FROM_USER;
  
  if (!fromUser) {
    console.error('📸 ERROR: RTM_FROM_USER environment variable is not set');
    return `Failed to send photo: Missing RTM_FROM_USER configuration.`;
  }
  
  if (!appId) {
    console.error('📸 ERROR: appId is missing');
    return `Failed to send photo: Missing appId.`;
  }

  // Randomize photo selection from available options
  const randomIndex = Math.floor(Math.random() * PHOTO_OPTIONS.length);
  const selectedPhoto = PHOTO_OPTIONS[randomIndex];
  const imageUrl = `https://sa-utils.agora.io/mms/${selectedPhoto}`;
  
  console.log(`📸 Randomly selected photo: ${selectedPhoto} (${randomIndex + 1}/${PHOTO_OPTIONS.length})`);
  console.log(`📸 Full image URL: ${imageUrl}`);
  console.log(`📸 Using fromUser: ${fromUser}, appId: ${appId}, channel: ${channel}`);
  
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
      console.log(`📸 SUCCESS: ${result}`);
    } else {
      result = `We encountered an issue scheduling the photo. Please try again later.`;
      console.log(`📸 FAILURE: ${result}`);
    }
    
    console.log(`📸 PHOTO TOOL RESULT: ${result}`);
    return result;
  } catch (error) {
    console.error(`📸 PHOTO TOOL ERROR:`, error);
    const errorResult = `Error sending photo: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.log(`📸 PHOTO TOOL ERROR RESULT:`, errorResult);
    return errorResult;
  }
}

// Create the tool map with debug wrappers
const EXAMPLE_TOOL_MAP = {
  order_sandwich: (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 TOOL MAP: order_sandwich wrapper called for channel: ${channel}`);
    try {
      const result = order_sandwich(appId, userId, channel, args);
      console.log(`🔧 TOOL MAP: order_sandwich wrapper completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 TOOL MAP: order_sandwich wrapper error:`, error);
      throw error;
    }
  },
  send_photo: async (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 TOOL MAP: send_photo wrapper called for channel: ${channel}, args:`, args);
    try {
      const result = await send_photo(appId, userId, channel, args);
      console.log(`🔧 TOOL MAP: send_photo wrapper completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 TOOL MAP: send_photo wrapper error:`, error);
      throw error;
    }
  }
};

// Debug logging at module load time
console.log('🔧 Example endpoint tool map configured with tools:', Object.keys(EXAMPLE_TOOL_MAP));
console.log('🔧 send_photo function type:', typeof EXAMPLE_TOOL_MAP.send_photo);
console.log('🔧 order_sandwich function type:', typeof EXAMPLE_TOOL_MAP.order_sandwich);
console.log('📸 Available photo options:', PHOTO_OPTIONS);
console.log('📸 Photo rate limit configured:', PHOTO_RATE_LIMIT_MS, 'ms (timestamp-based)');

// Export the complete endpoint configuration with communication modes
export const exampleEndpointConfig: EndpointConfig = {
  ragData: EXAMPLE_RAG_DATA,
  tools: EXAMPLE_TOOLS,
  toolMap: EXAMPLE_TOOL_MAP,
  systemMessageTemplate: exampleSystemTemplate,
  communicationModes: {
    supportsChat: true,
    endpointMode: 'video'
  }
};