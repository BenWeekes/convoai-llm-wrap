// File: lib/common/utils.ts
// Common utility functions shared across endpoints
// Enhanced with configurable debug logging

import OpenAI from 'openai';
import { CONFIG } from './cache';

/**
 * Safe JSON parsing with error recovery
 */
export function safeJSONParse(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace !== -1) {
      const candidate = jsonStr.substring(0, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (err2) {
        console.error("Safe JSON parse recovery failed:", err2);
        throw err2;
      }
    }
    throw err;
  }
}

/**
 * Generate a unique call ID for tool calls
 */
export function generateCallId(): string {
  return "call_" + Math.random().toString(36).slice(2, 8);
}

/**
 * Extract commands from text that start with <trl- and end with />
 * Returns the extracted commands and the cleaned text without the commands
 */
export function extractCommands(text: string): { extractedCommands: string[], cleanedText: string } {
  const extractedCommands: string[] = [];
  let cleanedText = text;
  
  // Define the regex pattern to find commands
  // Match anything that starts with <trl- and ends with />
  const pattern = /<trl-[^>]*?\/>/g;
  
  // Find all matches
  const matches = text.match(pattern);
  
  if (matches && matches.length > 0) {
    // Store all matches in the extracted commands array
    extractedCommands.push(...matches);
    
    // Remove all commands from the cleaned text
    cleanedText = text.replace(pattern, '');
    
    // Log the extracted commands
    console.log(`Extracted ${matches.length} commands from text:`, matches);
  }
  
  return { extractedCommands, cleanedText };
}

/**
 * Logs the full response in a nice, boxed format if detailed logging is enabled
 */
export function logFullResponse(type: string, data: any): void {
  // Skip detailed logging if disabled
  if (!CONFIG.enableDetailedResponseLogging) {
    // Log a minimal message instead
    console.log(`Response sent: ${type} (detailed logging disabled)`);
    return;
  }

  const separator = "=".repeat(80);
  console.log(separator);
  console.log(`📤 RESPONSE TO CALLER (${type}) 📤`);
  console.log(separator);
  
  // Extract and log tool-related items first if present
  if (Array.isArray(data)) {
    const toolItems = data.filter(item => 
      item.type === "tool_execution" || 
      (item.data && item.data.choices && item.data.choices[0] && item.data.choices[0].delta && item.data.choices[0].delta.tool_calls) ||
      (item.data && item.data.choices && item.data.choices[0] && item.data.choices[0].tool_calls)
    );
    
    if (toolItems.length > 0) {
      console.log(`\n🔧 TOOL-RELATED RESPONSES (${toolItems.length} items):`);
      for (const toolItem of toolItems) {
        console.dir(toolItem, { depth: null, colors: true });
      }
      console.log(separator);
    }
  }
  
  // Then log the complete response
  console.log("\n📋 COMPLETE RESPONSE:");
  
  if (Array.isArray(data)) {
    console.log(`Array with ${data.length} items:`);
    
    if (data.length > 0) {
      // For large arrays, show a subset with indication of omitted items
      if (data.length > 20) {
        // Show first 5 items
        for (let i = 0; i < 5 && i < data.length; i++) {
          console.dir(data[i], { depth: null, colors: true });
        }
        
        console.log(`\n... ${data.length - 10} items omitted for brevity ...\n`);
        
        // Show last 5 items
        for (let i = Math.max(5, data.length - 5); i < data.length; i++) {
          console.dir(data[i], { depth: null, colors: true });
        }
      } else {
        // For smaller arrays, show all items in order
        for (let i = 0; i < data.length; i++) {
          console.dir(data[i], { depth: null, colors: true });
        }
      }
    } else {
      console.log("Empty array");
    }
  } else {
    console.dir(data, { depth: null, colors: true });
  }
  
  console.log(separator);
}

/**
 * Validate authorization token
 */
export function validateToken(authHeader: string | null, expectedToken: string): boolean {
  const token = (authHeader || '').replace('Bearer ', '');
  return token === expectedToken;
}

/**
 * Check if a model needs special handling
 */
export function modelRequiresSpecialHandling(model: string): boolean {
  // List of models that might need special handling
  const specialModels = [
    'mistral', 
    'mixtral',
    'claude',
    'falcon',
    'command',
    'cohere',
    'gemini'
  ];
  
  // Check if the model name contains any of the special model identifiers
  return specialModels.some(specialModel => 
    model.toLowerCase().includes(specialModel.toLowerCase())
  );
}

/**
 * Check if this is a follow-up with tool responses
 */
export function isFollowUpWithToolResponsesPresent(messages: any[]): boolean {
  for (let i = 0; i < messages.length - 1; i++) {
    // Look for an assistant message with tool_calls followed by a tool response
    if (
      messages[i].role === 'assistant' && 
      messages[i].tool_calls && 
      messages[i+1].role === 'tool'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Simplify messages for Llama models
 */
export function simplifyMessagesForLlama(messages: any[]): any[] {
  // If this is a follow-up message after a tool call, simplify the history
  if (isFollowUpWithToolResponsesPresent(messages)) {
    const systemMessages = messages.filter(m => m.role === 'system');
    
    // Find the last user message
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    
    if (lastUserMessage) {
      // Create a simpler history
      console.log("Simplifying message history for Llama model follow-up");
      return [...systemMessages, lastUserMessage];
    }
  }
  
  // Otherwise return the original messages
  return messages;
}

// ============================================================================
// NEW DEBUG LOGGING FUNCTIONS WITH CONFIGURATION
// ============================================================================

/**
 * Logs LLM request details with communication mode context
 */
export function logLLMRequest(requestParams: any, context: {
  userId: string;
  appId: string;
  channel: string;
  endpointMode?: string;
  conversationLength: number;
}): void {
  if (!CONFIG.enableLLMRequestLogging) return;

  const separator = "🤖".repeat(40);
  console.log(separator);
  console.log(`🤖 LLM REQUEST DEBUG - ${new Date().toISOString()}`);
  console.log(separator);
  
  console.log(`📋 REQUEST CONTEXT:`);
  console.log(`- User: ${context.userId}`);
  console.log(`- App: ${context.appId}`);
  console.log(`- Channel: ${context.channel}`);
  console.log(`- Endpoint Mode: ${context.endpointMode || 'not specified'}`);
  console.log(`- Conversation Length: ${context.conversationLength} messages`);
  console.log(`- Model: ${requestParams.model}`);
  console.log(`- Stream: ${requestParams.stream}`);
  console.log(`- Tools Available: ${requestParams.tools ? requestParams.tools.length : 0}`);
  
  console.log(`\n💬 MESSAGES BEING SENT TO LLM (${requestParams.messages.length} total):`);
  requestParams.messages.forEach((msg: any, index: number) => {
    const modeInfo = msg.mode ? ` [MODE: ${msg.mode}]` : '';
    const truncatedContent = msg.content ? 
      (msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content) : 
      '[no content]';
    
    if (msg.role === 'system') {
      console.log(`[${index}] 🎯 SYSTEM${modeInfo}:`);
      console.log(`    ${truncatedContent}`);
    } else if (msg.role === 'user') {
      console.log(`[${index}] 👤 USER${modeInfo}: ${truncatedContent}`);
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls) {
        console.log(`[${index}] 🤖 ASSISTANT${modeInfo}: [${msg.tool_calls.length} tool calls]`);
      } else {
        console.log(`[${index}] 🤖 ASSISTANT${modeInfo}: ${truncatedContent}`);
      }
    } else if (msg.role === 'tool') {
      console.log(`[${index}] 🔧 TOOL (${msg.name || 'unknown'}): ${truncatedContent}`);
    }
  });
  
  // Highlight system message mode context
  const systemMsg = requestParams.messages.find((m: any) => m.role === 'system');
  if (systemMsg && systemMsg.content.includes('CURRENT COMMUNICATION MODE')) {
    console.log(`\n🎯 COMMUNICATION MODE CONTEXT IN SYSTEM MESSAGE:`);
    const modeLines = systemMsg.content.split('\n').filter((line: string) => 
      line.includes('CURRENT COMMUNICATION MODE') || 
      line.includes('AVAILABLE MODES') ||
      line.includes('VIDEO') ||
      line.includes('VOICE') ||
      line.includes('CHAT')
    );
    modeLines.forEach((line: string) => console.log(`    ${line.trim()}`));
  }
  
  console.log(separator);
}

/**
 * Logs LLM response details with mode analysis
 */
export function logLLMResponse(response: any, context: {
  userId: string;
  appId: string;
  channel: string;
  endpointMode?: string;
  requestType: 'streaming' | 'non-streaming';
}): void {
  if (!CONFIG.enableLLMResponseLogging) return;

  const separator = "🎭".repeat(40);
  console.log(separator);
  console.log(`🎭 LLM RESPONSE DEBUG - ${new Date().toISOString()}`);
  console.log(separator);
  
  console.log(`📋 RESPONSE CONTEXT:`);
  console.log(`- User: ${context.userId}`);
  console.log(`- App: ${context.appId}`);
  console.log(`- Channel: ${context.channel}`);
  console.log(`- Endpoint Mode: ${context.endpointMode || 'not specified'}`);
  console.log(`- Request Type: ${context.requestType}`);
  
  if (context.requestType === 'streaming') {
    console.log(`\n🌊 STREAMING RESPONSE - see individual chunk logs below`);
  } else {
    // Non-streaming response
    const choice = response?.choices?.[0];
    if (choice) {
      console.log(`\n🤖 LLM COMPLETE RESPONSE:`);
      console.log(`- Finish Reason: ${choice.finish_reason}`);
      
      if (choice.message?.content) {
        console.log(`- Content Length: ${choice.message.content.length} chars`);
        console.log(`- Content: ${choice.message.content}`);
        
        // Analyze content for mode-related keywords
        const content = choice.message.content.toLowerCase();
        const modeKeywords = ['video', 'call', 'chat', 'hang up', 'switch', 'text'];
        const foundKeywords = modeKeywords.filter(keyword => content.includes(keyword));
        if (foundKeywords.length > 0) {
          console.log(`- Mode-Related Keywords Found: ${foundKeywords.join(', ')}`);
        }
      }
      
      if (choice.message?.tool_calls) {
        console.log(`- Tool Calls: ${choice.message.tool_calls.length}`);
        choice.message.tool_calls.forEach((call: any, index: number) => {
          console.log(`  [${index}] ${call.function?.name}: ${call.function?.arguments}`);
        });
      }
    }
  }
  
  console.log(separator);
}

/**
 * Logs streaming chunk details with mode context
 */
export function logStreamingChunk(chunk: any, context: {
  userId: string;
  chunkIndex: number;
  hasToolCalls: boolean;
  hasContent: boolean;
  finishReason?: string;
}): void {
  if (!CONFIG.enableStreamingChunkLogging) return;

  const prefix = `🌊 CHUNK[${context.chunkIndex}]`;
  
  if (context.hasToolCalls) {
    console.log(`${prefix} 🔧 TOOL_CALLS for ${context.userId}`);
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.tool_calls) {
      delta.tool_calls.forEach((call: any, i: number) => {
        if (call.function?.name) {
          console.log(`  ${prefix} Tool[${i}]: ${call.function.name}`);
        }
        if (call.function?.arguments) {
          console.log(`  ${prefix} Args[${i}]: ${call.function.arguments}`);
        }
      });
    }
  }
  
  if (context.hasContent) {
    const content = chunk.choices?.[0]?.delta?.content || '';
    console.log(`${prefix} 💬 CONTENT for ${context.userId}: "${content}"`);
    
    // Check for mode-related content
    const contentLower = content.toLowerCase();
    if (contentLower.includes('video') || contentLower.includes('call') || 
        contentLower.includes('chat') || contentLower.includes('hang up')) {
      console.log(`${prefix} 🎯 MODE-RELATED CONTENT DETECTED`);
    }
  }
  
  if (context.finishReason) {
    console.log(`${prefix} 🏁 FINISH_REASON for ${context.userId}: ${context.finishReason}`);
  }
}

/**
 * Logs conversation mode transition
 */
export function logModeTransition(context: {
  userId: string;
  appId: string;
  fromMode?: string;
  toMode?: string;
  channel: string;
  trigger: string; // 'api_call' | 'rtm_message' | 'hangup' | 'unknown'
}): void {
  if (!CONFIG.enableModeTransitionLogging) return;

  const separator = "🔄".repeat(30);
  console.log(separator);
  console.log(`🔄 MODE TRANSITION DEBUG - ${new Date().toISOString()}`);
  console.log(`- User: ${context.userId}`);
  console.log(`- App: ${context.appId}`);
  console.log(`- Channel: ${context.channel}`);
  console.log(`- From Mode: ${context.fromMode || 'unknown'}`);
  console.log(`- To Mode: ${context.toMode || 'unknown'}`);
  console.log(`- Trigger: ${context.trigger}`);
  console.log(separator);
}

/**
 * Logs RTM message processing with mode context
 */
export function logRTMMessageProcessing(context: {
  userId: string;
  appId: string;
  messageContent: string;
  channel: string;
  timestamp: number;
}): void {
  if (!CONFIG.enableRTMMessageLogging) return;

  const separator = "📨".repeat(40);
  console.log(separator);
  console.log(`📨 RTM MESSAGE PROCESSING - ${new Date().toISOString()}`);
  console.log(separator);
  
  console.log(`📋 RTM MESSAGE CONTEXT:`);
  console.log(`- User: ${context.userId}`);
  console.log(`- App: ${context.appId}`);
  console.log(`- Channel: ${context.channel}`);
  console.log(`- Timestamp: ${new Date(context.timestamp).toISOString()}`);
  console.log(`- Message Length: ${context.messageContent.length} chars`);
  console.log(`- Message Content: ${context.messageContent}`);
  
  // Analyze message for mode-related keywords
  const contentLower = context.messageContent.toLowerCase();
  const modeKeywords = ['video', 'call', 'chat', 'hang up', 'switch', 'text', 'bye', 'goodbye'];
  const foundKeywords = modeKeywords.filter(keyword => contentLower.includes(keyword));
  if (foundKeywords.length > 0) {
    console.log(`📨 MODE-RELATED KEYWORDS DETECTED: ${foundKeywords.join(', ')}`);
  }
  
  console.log(separator);
}