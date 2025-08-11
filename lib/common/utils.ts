// File: lib/common/utils.ts
// Updated with proper logging system

import OpenAI from 'openai';
import { CONFIG } from './cache';
import { llmLogger, createLogger } from './logger';

const utilLogger = createLogger('UTILS');

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
        utilLogger.error("Safe JSON parse recovery failed", err2);
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
    utilLogger.debug(`Extracted commands from text`, { count: matches.length, commands: matches });
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
    utilLogger.trace(`Response sent: ${type}`);
    return;
  }

  utilLogger.debug(`📤 RESPONSE TO CALLER (${type})`, { type });
  
  // Extract and log tool-related items first if present
  if (Array.isArray(data)) {
    const toolItems = data.filter(item => 
      item.type === "tool_execution" || 
      (item.data && item.data.choices && item.data.choices[0] && item.data.choices[0].delta && item.data.choices[0].delta.tool_calls) ||
      (item.data && item.data.choices && item.data.choices[0] && item.data.choices[0].tool_calls)
    );
    
    if (toolItems.length > 0) {
      utilLogger.debug(`Tool-related responses`, { count: toolItems.length, items: toolItems });
    }
  }
  
  // Then log the complete response
  if (Array.isArray(data)) {
    utilLogger.debug(`Complete response array`, { 
      itemCount: data.length,
      preview: data.length > 20 ? 'truncated' : 'full',
      items: data.length > 20 ? [...data.slice(0, 5), '...', ...data.slice(-5)] : data
    });
  } else {
    utilLogger.debug(`Complete response`, data);
  }
}

/**
 * Validate authorization token
 */
export function validateToken(authHeader: string | null, expectedToken: string): boolean {
  const token = (authHeader || '').replace('Bearer ', '');
  const isValid = token === expectedToken;
  
  if (!isValid) {
    utilLogger.warn('Invalid token attempted');
  }
  
  return isValid;
}

// ============================================================================
// DEBUG LOGGING FUNCTIONS WITH CONFIGURATION
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

  llmLogger.debug('LLM Request', {
    context: {
      userId: context.userId,
      appId: context.appId,
      channel: context.channel,
      endpointMode: context.endpointMode || 'not specified',
      conversationLength: context.conversationLength
    },
    request: {
      model: requestParams.model,
      stream: requestParams.stream,
      toolCount: requestParams.tools ? requestParams.tools.length : 0,
      messageCount: requestParams.messages.length
    }
  });
  
  // Log message summary if trace level
  if (requestParams.messages) {
    const messageSummary = requestParams.messages.map((msg: any, index: number) => {
      const truncatedContent = msg.content ? 
        (msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content) : 
        '[no content]';
      
      return {
        index,
        role: msg.role,
        contentLength: msg.content?.length || 0,
        hasToolCalls: !!msg.tool_calls,
        preview: truncatedContent.substring(0, 50)
      };
    });
    
    llmLogger.trace('Message details', messageSummary);
  }
  
  // Highlight system message mode context
  const systemMsg = requestParams.messages.find((m: any) => m.role === 'system');
  if (systemMsg && systemMsg.content.includes('CURRENT COMMUNICATION MODE')) {
    const modeLines = systemMsg.content.split('\n').filter((line: string) => 
      line.includes('CURRENT COMMUNICATION MODE') || 
      line.includes('AVAILABLE MODES')
    ).map((line: string) => line.trim());
    
    llmLogger.debug('Communication mode context in system message', modeLines);
  }
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

  if (context.requestType === 'streaming') {
    llmLogger.debug('LLM Streaming Response Started', context);
  } else {
    // Non-streaming response
    const choice = response?.choices?.[0];
    if (choice) {
      const responseData: any = {
        context,
        finishReason: choice.finish_reason,
        hasContent: !!choice.message?.content,
        hasToolCalls: !!choice.message?.tool_calls
      };
      
      if (choice.message?.content) {
        responseData.contentLength = choice.message.content.length;
        
        // Analyze content for mode-related keywords
        const content = choice.message.content.toLowerCase();
        const modeKeywords = ['video', 'call', 'chat', 'hang up', 'switch', 'text'];
        const foundKeywords = modeKeywords.filter(keyword => content.includes(keyword));
        if (foundKeywords.length > 0) {
          responseData.modeKeywords = foundKeywords;
        }
      }
      
      if (choice.message?.tool_calls) {
        responseData.toolCalls = choice.message.tool_calls.map((call: any) => ({
          name: call.function?.name,
          hasArgs: !!call.function?.arguments
        }));
      }
      
      llmLogger.debug('LLM Response Complete', responseData);
      
      if (choice.message?.content) {
        llmLogger.trace('Response content', choice.message.content);
      }
    }
  }
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

  const chunkData: any = {
    userId: context.userId,
    index: context.chunkIndex
  };
  
  if (context.hasToolCalls) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.tool_calls) {
      chunkData.toolCalls = delta.tool_calls.map((call: any, i: number) => ({
        index: i,
        name: call.function?.name,
        hasArgs: !!call.function?.arguments
      }));
    }
    llmLogger.trace('Stream chunk with tool calls', chunkData);
  }
  
  if (context.hasContent) {
    const content = chunk.choices?.[0]?.delta?.content || '';
    chunkData.contentLength = content.length;
    
    // Check for mode-related content
    const contentLower = content.toLowerCase();
    if (contentLower.includes('video') || contentLower.includes('call') || 
        contentLower.includes('chat') || contentLower.includes('hang up')) {
      chunkData.modeRelated = true;
    }
    
    llmLogger.trace('Stream chunk with content', chunkData);
  }
  
  if (context.finishReason) {
    llmLogger.debug('Stream finished', { 
      userId: context.userId,
      finishReason: context.finishReason 
    });
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

  llmLogger.info('Mode transition detected', {
    userId: context.userId,
    appId: context.appId,
    channel: context.channel,
    transition: `${context.fromMode || 'unknown'} → ${context.toMode || 'unknown'}`,
    trigger: context.trigger
  });
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

  const messageData: any = {
    userId: context.userId,
    appId: context.appId,
    channel: context.channel,
    messageLength: context.messageContent.length,
    timestamp: new Date(context.timestamp).toISOString()
  };
  
  // Analyze message for mode-related keywords
  const contentLower = context.messageContent.toLowerCase();
  const modeKeywords = ['video', 'call', 'chat', 'hang up', 'switch', 'text', 'bye', 'goodbye'];
  const foundKeywords = modeKeywords.filter(keyword => contentLower.includes(keyword));
  if (foundKeywords.length > 0) {
    messageData.modeKeywords = foundKeywords;
  }
  
  llmLogger.debug('RTM message received', messageData);
  llmLogger.trace('RTM message content', context.messageContent);
}