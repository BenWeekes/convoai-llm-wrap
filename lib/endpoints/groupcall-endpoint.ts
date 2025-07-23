// lib/endpoints/groupcall-endpoint.ts
// Configuration for the group call/chat endpoint 
// Simplified - manual prefixing instructions removed (now handled by shared helpers)

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';

// Define RAG data for this endpoint
const GROUPCALL_RAG_DATA = {
  doc1: "This is a group chat and calling system where multiple users can interact.",
  doc2: "You can see which user sent each message by their user ID.",
  doc3: "When responding, you can address users by their user ID if needed.",
  doc4: "The system supports both group chat (RTM) and group video calls."
};

// Define the system message template - focused on core group call behavior
// Prefixing instructions are automatically added by the shared system prompt helpers
function groupCallSystemTemplate(ragData: Record<string, string>): string {
  // Get base prompt from environment variable
  const basePrompt = process.env.GROUPCALL_RTM_LLM_PROMPT || 
    'You are a helpful assistant in a group chat/call setting.';

  return `
    ${basePrompt}

    GROUP CALL SPECIFIC BEHAVIOR:
    - This is a GROUP environment where MULTIPLE users can participate simultaneously
    - You are facilitating a group conversation - encourage interaction between users
    - Keep track of the conversation flow and help users engage with each other
    - You can moderate the discussion and help resolve conflicts if they arise
    - Be aware that users may join or leave the group during the conversation
    
    RESPONSE GUIDELINES:
    - Use inclusive language that addresses the group when appropriate
    - When users ask questions that others might benefit from, share answers with the group
    - Help facilitate introductions when new users join
    - Keep responses concise in group settings to allow others to participate
    - You can suggest topics or activities that involve multiple participants
    
    You have access to the following knowledge:
    doc1: "${ragData.doc1}"
    doc2: "${ragData.doc2}"
    doc3: "${ragData.doc3}"
    doc4: "${ragData.doc4}"
  `;
}

// No tools defined - keeping it simple for now
const GROUPCALL_TOOLS: OpenAI.ChatCompletionTool[] = [];

// Empty tool map - no tools to implement
const GROUPCALL_TOOL_MAP = {};

// Debug logging at module load time
console.log('🔧 Group call endpoint configured with simplified system template');
console.log('📝 User ID and communication mode prefixing handled automatically by shared helpers');

// Export the complete endpoint configuration with communication modes
export const groupCallEndpointConfig: EndpointConfig = {
  ragData: GROUPCALL_RAG_DATA,
  tools: GROUPCALL_TOOLS,
  toolMap: GROUPCALL_TOOL_MAP,
  systemMessageTemplate: groupCallSystemTemplate,
  communicationModes: {
    supportsChat: true,
    endpointMode: 'video',           // Group video calling
    prependUserId: true,             // ✅ Enable user ID prefixing - instructions auto-generated
    prependCommunicationMode: false  // ❌ Disable communication mode prefixing for cleaner messages
  }
};