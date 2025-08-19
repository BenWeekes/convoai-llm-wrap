// File: lib/common/utils.ts
// Updated with improved response logging that shows actual content

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
 * Helper to format stream chunk data for better logging
 */
function formatStreamChunk(item: any): any {
  if (item.type === 'content_stream' && item.data) {
    const data = item.data;
    if (data.choices && data.choices[0] && data.choices[0].delta) {
      const delta = data.choices[0].delta;
      return {
        type: 'content_stream',
        content: delta.content || '[no content]',
        role: delta.role,
        hasToolCalls: !!delta.tool_calls,
        finishReason: data.choices[0].finish_reason
      };
    }
  } else if (item.type === 'tool_execution') {
    return {
      type: 'tool_execution',
      tool: item.tool_name,
      args: item.arguments,
      resultPreview: item.result ? item.result.substring(0, 100) : '[no result]'
    };
  } else if (item.type === 'tool_stream' && item.data) {
    const data = item.data;
    if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.tool_calls) {
      const toolCalls = data.choices[0].delta.tool_calls;
      return {
        type: 'tool_stream',
        toolCalls: toolCalls.map((tc: any) => ({
          name: tc.function?.name,
          argsFragment: tc.function?.arguments ? tc.function.arguments.substring(0, 50) : undefined
        }))
      };
    }
  }
  
  // For other types, return a simplified version
  return {
    type: item.type || 'unknown',
    hasData: !!item.data,
    marker: item.marker
  };
}

/**
 * Logs the full response in a nice, boxed format if detailed logging is enabled
 * IMPROVED to show actual content instead of [Object]
 */
export function logFullResponse(type: string, data: any): void {
  // Skip detailed logging if disabled
  if (!CONFIG.enableDetailedResponseLogging) {
    // Log a minimal message instead
    utilLogger.trace(`Response sent: ${type}`);
    return;
  }

  utilLogger.debug(`📤 RESPONSE TO CALLER (${type})`, { type });
  
  // Handle array responses (streaming)
  if (Array.isArray(data)) {
    // Extract and log tool-related items first if present
    const toolItems = data.filter(item => 
      item.type === "tool_execution" || 
      item.type === "tool_stream" ||
      (item.data && item.data.choices && item.data.choices[0] && item.data.choices[0].delta && item.data.choices[0].delta.tool_calls) ||
      (item.data && item.data.choices && item.data.choices[0] && item.data.choices[0].tool_calls)
    );
    
    if (toolItems.length > 0) {
      const formattedTools = toolItems.map(formatStreamChunk);
      utilLogger.debug(`Tool-related responses`, { 
        count: toolItems.length, 
        items: formattedTools 
      });
    }
    
    // Format all items for better visibility
    const formattedItems = data.map(formatStreamChunk);
    
    // Group consecutive content_stream items for cleaner logging
    const groupedItems: any[] = [];
    let currentContentGroup: string[] = [];
    
    for (const item of formattedItems) {
      if (item.type === 'content_stream' && item.content && item.content !== '[no content]') {
        currentContentGroup.push(item.content);
      } else {
        // Flush current content group if exists
        if (currentContentGroup.length > 0) {
          groupedItems.push({
            type: 'content_group',
            chunks: currentContentGroup.length,
            combinedContent: currentContentGroup.join('').substring(0, 200) + 
                           (currentContentGroup.join('').length > 200 ? '...' : '')
          });
          currentContentGroup = [];
        }
        // Add non-content item
        if (item.type !== 'content_stream' || item.content === '[no content]') {
          groupedItems.push(item);
        }
      }
    }
    
    // Flush any remaining content group
    if (currentContentGroup.length > 0) {
      groupedItems.push({
        type: 'content_group',
        chunks: currentContentGroup.length,
        combinedContent: currentContentGroup.join('').substring(0, 200) + 
                       (currentContentGroup.join('').length > 200 ? '...' : '')
      });
    }
    
    utilLogger.debug(`Complete response array`, { 
      itemCount: data.length,
      groupedItemCount: groupedItems.length,
      items: groupedItems
    });
  } else {
    // Non-array response - format it nicely
    if (data.choices && Array.isArray(data.choices)) {
      // Format OpenAI response
      const formattedResponse = {
        model: data.model,
        usage: data.usage,
        choices: data.choices.map((choice: any) => ({
          index: choice.index,
          finishReason: choice.finish_reason,
          message: {
            role: choice.message?.role,
            contentPreview: choice.message?.content ? 
              choice.message.content.substring(0, 200) + 
              (choice.message.content.length > 200 ? '...' : '') : 
              '[no content]',
            toolCalls: choice.message?.tool_calls?.map((tc: any) => ({
              id: tc.id,
              type: tc.type,
              function: {
                name: tc.function?.name,
                argumentsPreview: tc.function?.arguments ? 
                  tc.function.arguments.substring(0, 100) : 
                  '[no arguments]'
              }
            }))
          }
        }))
      };
      utilLogger.debug(`Complete response`, formattedResponse);
    } else {
      // Other response types
      utilLogger.debug(`Complete response`, data);
    }
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
 * IMPROVED to show actual message content
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
  
  // Log message details with better formatting
  if (requestParams.messages && process.env.LOG_LEVEL === 'TRACE') {
    const messageSummary = requestParams.messages.map((msg: any, index: number) => {
      // Extract user ID from content if present
      let displayContent = msg.content || '[no content]';
      let extractedUserId = null;
      
      if (msg.role === 'user' && displayContent.startsWith('[')) {
        const match = displayContent.match(/^\[([^\]]+)\]\s*(.*)/);
        if (match) {
          extractedUserId = match[1];
          displayContent = match[2];
        }
      }
      
      const truncatedContent = displayContent.length > 200 ? 
        displayContent.substring(0, 200) + '...' : 
        displayContent;
      
      return {
        index,
        role: msg.role,
        userId: extractedUserId,
        contentLength: msg.content?.length || 0,
        hasToolCalls: !!msg.tool_calls,
        preview: truncatedContent.substring(0, 100)
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
        responseData.contentPreview = choice.message.content.substring(0, 200);
        
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
      
      if (choice.message?.content && process.env.LOG_LEVEL === 'TRACE') {
        llmLogger.trace('Full response content', choice.message.content);
      }
    }
  }
}

/**
 * Logs streaming chunk details with mode context
 * Reduced verbosity for cleaner logs
 */
export function logStreamingChunk(chunk: any, context: {
  userId: string;
  chunkIndex: number;
  hasToolCalls: boolean;
  hasContent: boolean;
  finishReason?: string;
}): void {
  if (!CONFIG.enableStreamingChunkLogging) return;

  // Only log significant chunks
  if (context.finishReason) {
    llmLogger.debug('Stream finished', { 
      userId: context.userId,
      finishReason: context.finishReason 
    });
  } else if (context.hasToolCalls) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.tool_calls) {
      const toolInfo = delta.tool_calls.map((call: any) => ({
        name: call.function?.name,
        hasArgs: !!call.function?.arguments
      }));
      llmLogger.trace('Stream chunk with tool calls', {
        userId: context.userId,
        index: context.chunkIndex,
        tools: toolInfo
      });
    }
  } else if (context.hasContent && process.env.LOG_LEVEL === 'TRACE') {
    // Only log content chunks in TRACE mode
    const content = chunk.choices?.[0]?.delta?.content || '';
    if (content.length > 0) {
      llmLogger.trace('Stream chunk', {
        userId: context.userId,
        index: context.chunkIndex,
        contentLength: content.length
      });
    }
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
  
  if (process.env.LOG_LEVEL === 'TRACE') {
    llmLogger.trace('RTM message content', context.messageContent);
  }
}