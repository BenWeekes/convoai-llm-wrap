// lib/endpoints/groupcall-endpoint.ts
// Configuration for the group call/chat endpoint with user ID awareness

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';

// Define RAG data for this endpoint
const GROUPCALL_RAG_DATA = {
  doc1: "This is a group chat and calling system where multiple users can interact.",
  doc2: "You can see which user sent each message by their user ID.",
  doc3: "When responding, you can address users by their user ID if needed.",
  doc4: "The system supports both group chat (RTM) and group video calls."
};

// Define the system message template for this endpoint with group behavior
function groupCallSystemTemplate(ragData: Record<string, string>): string {
  // Get base prompt from environment variable
  const basePrompt = process.env.GROUPCALL_RTM_LLM_PROMPT || 
    'You are a helpful assistant in a group chat/call setting.';

  return `
    ${basePrompt}

    GROUP COMMUNICATION CONTEXT:
    - This is a GROUP environment where MULTIPLE users can participate
    - User messages are prefixed with their user ID like "[user123] Hello there"
    - When responding, you can address specific users: "@user123 thanks for your question!"
    - You can address the whole group: "Hi everyone!" or mention specific users
    - Be aware of the conversation flow between different users
    
    COMMUNICATION MODE BEHAVIOR:
    - Messages have "mode" field: "chat" (group texting), "video" (group video call)
    - In CHAT mode: Multiple users texting in a group chat
    - In VIDEO mode: Multiple users on a group video call
    - Respond appropriately to the group context and current mode
    
    GROUP INTERACTION GUIDELINES:
    - Pay attention to WHO is speaking (user IDs in message prefixes)
    - You can facilitate conversations between users
    - Address users by name/ID when relevant
    - Keep track of different users' contexts and needs
    - Encourage group participation when appropriate
    
    You have access to the following knowledge:
    doc1: "${ragData.doc1}"
    doc2: "${ragData.doc2}"
    doc3: "${ragData.doc3}"
    doc4: "${ragData.doc4}"
    
    When you receive information from tools, make sure to reference specific details 
    from their responses and consider how they might be relevant to the group.
  `;
}

// Define the tools for this endpoint
const GROUPCALL_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_group_info",
      description: "Get information about the current group session, including active users",
      parameters: {
        type: "object",
        properties: {
          info_type: {
            type: "string",
            description: "Type of info to get: 'users', 'activity', 'summary'",
            enum: ["users", "activity", "summary"]
          }
        },
        required: ["info_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_group_announcement",
      description: "Send an announcement or notification to all group members",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The announcement message to send to all group members"
          },
          priority: {
            type: "string",
            description: "Priority level: 'low', 'normal', 'high'",
            enum: ["low", "normal", "high"]
          }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "moderate_group",
      description: "Perform group moderation actions like muting, warnings, etc.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Moderation action to take",
            enum: ["warn", "mute", "unmute", "kick"]
          },
          target_user: {
            type: "string",
            description: "User ID to target for moderation (optional for general actions)"
          },
          reason: {
            type: "string",
            description: "Reason for the moderation action"
          }
        },
        required: ["action"]
      }
    }
  }
];

// Implement the tool functions
async function get_group_info(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const infoType = args?.info_type || "summary";
  
  console.log(`📊 GROUP INFO TOOL CALLED:`, { appId, userId, channel, infoType });
  
  // This is a mock implementation - in real system you'd query actual group data
  switch (infoType) {
    case 'users':
      return JSON.stringify({
        active_users: ['user123', 'user456', 'user789'],
        total_participants: 3,
        online_count: 2
      });
    
    case 'activity':
      return JSON.stringify({
        recent_activity: [
          { user: 'user123', action: 'joined_call', timestamp: Date.now() - 300000 },
          { user: 'user456', action: 'sent_message', timestamp: Date.now() - 120000 },
          { user: 'user789', action: 'shared_screen', timestamp: Date.now() - 60000 }
        ]
      });
    
    case 'summary':
    default:
      return JSON.stringify({
        group_id: channel,
        active_users: 3,
        current_mode: 'video_call',
        session_duration: '15 minutes',
        last_activity: 'user789 shared screen'
      });
  }
}

async function send_group_announcement(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const message = args?.message || "Group announcement";
  const priority = args?.priority || "normal";
  
  console.log(`📢 GROUP ANNOUNCEMENT TOOL CALLED:`, { appId, userId, channel, message, priority });
  
  // In a real implementation, this would send the announcement through the RTM system
  // For now, we'll return a confirmation
  const result = `📢 Group announcement sent to channel ${channel}: "${message}" (Priority: ${priority})`;
  console.log(`📢 ANNOUNCEMENT RESULT:`, result);
  
  return result;
}

async function moderate_group(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const action = args?.action || "warn";
  const targetUser = args?.target_user;
  const reason = args?.reason || "No reason specified";
  
  console.log(`🛡️ GROUP MODERATION TOOL CALLED:`, { appId, userId, channel, action, targetUser, reason });
  
  let result: string;
  
  switch (action) {
    case 'warn':
      result = targetUser 
        ? `⚠️ Warning sent to ${targetUser}: ${reason}`
        : `⚠️ General warning sent to group: ${reason}`;
      break;
    
    case 'mute':
      result = targetUser 
        ? `🔇 User ${targetUser} has been muted. Reason: ${reason}`
        : `🔇 Group has been muted. Reason: ${reason}`;
      break;
    
    case 'unmute':
      result = targetUser 
        ? `🔊 User ${targetUser} has been unmuted.`
        : `🔊 Group has been unmuted.`;
      break;
    
    case 'kick':
      result = targetUser 
        ? `👋 User ${targetUser} has been removed from the group. Reason: ${reason}`
        : `👋 Kick action requires a target_user.`;
      break;
    
    default:
      result = `❌ Unknown moderation action: ${action}`;
  }
  
  console.log(`🛡️ MODERATION RESULT:`, result);
  return result;
}

// Create the tool map
const GROUPCALL_TOOL_MAP = {
  get_group_info: async (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 TOOL MAP: get_group_info wrapper called for channel: ${channel}`);
    try {
      const result = await get_group_info(appId, userId, channel, args);
      console.log(`🔧 TOOL MAP: get_group_info wrapper completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 TOOL MAP: get_group_info wrapper error:`, error);
      throw error;
    }
  },
  
  send_group_announcement: async (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 TOOL MAP: send_group_announcement wrapper called for channel: ${channel}`);
    try {
      const result = await send_group_announcement(appId, userId, channel, args);
      console.log(`🔧 TOOL MAP: send_group_announcement wrapper completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 TOOL MAP: send_group_announcement wrapper error:`, error);
      throw error;
    }
  },
  
  moderate_group: async (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 TOOL MAP: moderate_group wrapper called for channel: ${channel}`);
    try {
      const result = await moderate_group(appId, userId, channel, args);
      console.log(`🔧 TOOL MAP: moderate_group wrapper completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 TOOL MAP: moderate_group wrapper error:`, error);
      throw error;
    }
  }
};

// Debug logging at module load time
console.log('🔧 Group call endpoint tool map configured with tools:', Object.keys(GROUPCALL_TOOL_MAP));
console.log('🔧 Available tools:', Object.keys(GROUPCALL_TOOL_MAP));

// Export the complete endpoint configuration with communication modes
export const groupCallEndpointConfig: EndpointConfig = {
  ragData: GROUPCALL_RAG_DATA,
  tools: GROUPCALL_TOOLS,
  toolMap: GROUPCALL_TOOL_MAP,
  systemMessageTemplate: groupCallSystemTemplate,
  communicationModes: {
    supportsChat: true,
    endpointMode: 'video'  // Group video calling
  }
};
