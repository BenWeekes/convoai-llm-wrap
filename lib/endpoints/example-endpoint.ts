// File: lib/endpoints/example-endpoint.ts
// Configuration for the combined example endpoint with sandwich and photo tools
// Now includes RTM chat integration through the shared chat handler
// Updated with communication mode support and randomized photos

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
        /*
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Type of photo subject (e.g. 'face', 'full_body', 'landscape')"
          }
        },
        required: ["subject"]
        */
      }
    }
  }
];

// Available photo options for randomization
const PHOTO_OPTIONS = [
  "april_sit_kiss.png",
  "april_sit_smile.png", 
  "april_reach_camera.png",
  "april_lie_wink.png",
  "april_lie_smile.png",
  "april_lie_kiss.png"
];

// Implement the tool functions with enhanced logging
function order_sandwich(appId: string, userId: string, channel: string, args: any): string {
  const filling = args.filling || "Unknown";
  
  console.log(`🥪 SANDWICH TOOL CALLED:`, { appId, userId, channel, filling });
  console.log(`🥪 Placing sandwich order for ${userId} in ${channel} with filling: ${filling}`);
  
  const result = `Sandwich ordered with ${filling}. It will arrive at 3pm. Enjoy!`;
  console.log(`🥪 SANDWICH TOOL RESULT:`, result);
  
  return result;
}

async function send_photo(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const subject = args.subject || "default";

  console.log(`📸 PHOTO TOOL CALLED:`, { appId, userId, channel, subject });
  console.log(`📸 Sending ${subject} photo to ${userId} in ${channel}`);
  
  // Check environment variables - for RTM chat, use the RTM-specific from user
  let fromUser = process.env.RTM_FROM_USER;
  
  if (!fromUser) {
    console.error('📸 ERROR: RTM_FROM_USER or EXAMPLE_RTM_FROM_USER environment variable is not set');
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
    
    console.log(`📸 PHOTO TOOL RESULT:`, result);
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
    console.log(`🔧 TOOL MAP: send_photo wrapper called for channel: ${channel}`);
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