// File: lib/common/utils.ts
// Common utility functions shared across endpoints

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
