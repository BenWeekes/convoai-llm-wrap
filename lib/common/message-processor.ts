// File: lib/common/message-processor.ts
// Updated to use content prefixes instead of non-standard properties
// Fixed double-prefixing issue with better prefix detection

import { getToolResponse } from './cache';

// Mode prefix constants
const MODE_PREFIXES = {
  CHAT: '[CHAT]',
  VIDEO: '[VIDEO CALL]',
  VOICE: '[VOICE CALL]'
} as const;

/**
 * Add mode prefix to message content based on mode
 */
export function addModePrefix(content: string, mode?: string): string {
  // Don't add prefix if content already has one
  if (content.startsWith('[CHAT]') || content.startsWith('[VIDEO CALL]') || content.startsWith('[VOICE CALL]')) {
    return content;
  }

  switch (mode) {
    case 'chat':
      return `${MODE_PREFIXES.CHAT} ${content}`;
    case 'video':
      return `${MODE_PREFIXES.VIDEO} ${content}`;
    case 'voice':
      return `${MODE_PREFIXES.VOICE} ${content}`;
    default:
      return content; // No prefix for undefined/unknown modes
  }
}

/**
 * Add user ID prefix to message content for group calls
 * Format: [userId] message content
 * Fixed to prevent double-prefixing
 */
export function addUserIdPrefix(content: string, userId: string, endpoint?: string): string {
  // Check if content already has ANY user ID prefix pattern (not just matching this user)
  // This prevents double-prefixing
  const hasAnyPrefix = content.match(/^\[[^\]]+\]/);
  if (hasAnyPrefix) {
    // Only log if we're in debug mode to reduce noise
    if (process.env.LOG_LEVEL === 'DEBUG' || process.env.LOG_LEVEL === 'TRACE') {
      console.log(`[${endpoint || 'PROCESSOR'}] Skipping duplicate prefix: "${hasAnyPrefix[0]}" already exists`);
    }
    return content;
  }

  const prefixedContent = `[${userId}] ${content}`;
  // Only log the actual prefixing action in trace mode to reduce noise
  if (process.env.LOG_LEVEL === 'TRACE') {
    console.log(`[${endpoint || 'PROCESSOR'}] Added user ID prefix [${userId}]`);
  }
  return prefixedContent;
}

/**
 * Extract mode from message content prefix
 */
export function extractModeFromContent(content: string): { mode?: string; cleanContent: string } {
  if (content.startsWith(MODE_PREFIXES.CHAT)) {
    return {
      mode: 'chat',
      cleanContent: content.slice(MODE_PREFIXES.CHAT.length).trim()
    };
  }
  
  if (content.startsWith(MODE_PREFIXES.VIDEO)) {
    return {
      mode: 'video',
      cleanContent: content.slice(MODE_PREFIXES.VIDEO.length).trim()
    };
  }
  
  if (content.startsWith(MODE_PREFIXES.VOICE)) {
    return {
      mode: 'voice',
      cleanContent: content.slice(MODE_PREFIXES.VOICE.length).trim()
    };
  }
  
  return {
    cleanContent: content
  };
}

/**
 * Extract user ID from message content prefix
 * Returns the user ID and content without the user ID prefix
 * Handles nested prefixes correctly
 */
export function extractUserIdFromContent(content: string): { userId?: string; cleanContent: string } {
  // Look for the FIRST bracket pair only
  const userIdMatch = content.match(/^\[([^\]]+)\]\s*(.*)/);
  
  if (userIdMatch) {
    const extractedUserId = userIdMatch[1];
    const remainingContent = userIdMatch[2];
    
    // Check if there's a nested prefix (shouldn't happen with fix, but handle gracefully)
    const nestedMatch = remainingContent.match(/^\[([^\]]+)\]\s*(.*)/);
    if (nestedMatch) {
      console.warn(`[MESSAGE-PROCESSOR] Detected nested user ID prefix: [${extractedUserId}] [${nestedMatch[1]}]`);
      // Return the outer prefix and the content after all prefixes
      return {
        userId: extractedUserId,
        cleanContent: nestedMatch[2]
      };
    }
    
    return {
      userId: extractedUserId,
      cleanContent: remainingContent
    };
  }
  
  return {
    cleanContent: content
  };
}

/**
 * Extract the actual user ID from message metadata or fallback to provided userId
 * This is crucial for group conversations where different users send messages
 */
function getActualUserId(message: any, fallbackUserId?: string): string | undefined {
  // Check for metadata with publisher/user information
  if (message.metadata) {
    // Priority 1: Use publisher field from metadata
    if (message.metadata.publisher) {
      return message.metadata.publisher;
    }
    // Priority 2: Use user field from metadata
    if (message.metadata.user) {
      return message.metadata.user;
    }
  }
  
  // Priority 3: Check if message has a direct userId field
  if (message.userId) {
    return message.userId;
  }
  
  // Priority 4: Use the fallback userId provided
  return fallbackUserId;
}

/**
 * Clean message for LLM by removing non-standard properties and adding prefixes
 * Removes: mode, timestamp, and any other non-standard properties
 * Keeps only: role, content, name, tool_calls, tool_call_id
 * Adds mode prefixes and user ID prefixes when enabled
 * Fixed to prevent double-prefixing
 */
export function cleanMessageForLLM(message: any, options?: { 
  prependUserId?: boolean; 
  userId?: string;
  prependCommunicationMode?: boolean;
  endpoint?: string; // Add endpoint for better logging context
}): any {
  const cleaned: any = {
    role: message.role,
    content: message.content
  };

  // Add only standard OpenAI API properties if they exist
  if (message.name) cleaned.name = message.name;
  if (message.tool_calls) cleaned.tool_calls = message.tool_calls;
  if (message.tool_call_id) cleaned.tool_call_id = message.tool_call_id;

  // Process content based on message role and options
  if (message.role === 'user' && message.content) {
    let processedContent = message.content;
    
    // FIRST: Add user ID prefix when enabled (only for user messages)
    if (options?.prependUserId) {
      // Get the actual user ID from metadata or fallback
      const actualUserId = getActualUserId(message, options?.userId);
      
      if (actualUserId) {
        // Check if content already has a prefix to avoid double-prefixing
        const hasPrefix = processedContent.match(/^\[[^\]]+\]/);
        if (!hasPrefix) {
          processedContent = addUserIdPrefix(processedContent, actualUserId, options?.endpoint);
        } else if (process.env.LOG_LEVEL === 'DEBUG' || process.env.LOG_LEVEL === 'TRACE') {
          console.log(`[${options?.endpoint || 'PROCESSOR'}] Skipping user ID prefix - already has: ${hasPrefix[0]}`);
        }
      }
    }
    
    // SECOND: Add mode prefix if specified and enabled (only for user messages)
    if (message.mode && options?.prependCommunicationMode) {
      processedContent = addModePrefix(processedContent, message.mode);
    }
    
    cleaned.content = processedContent;
  } else if (message.role === 'assistant' && message.content) {
    // For assistant messages, clean any prefixes the LLM might have added
    let cleanedContent = message.content;
    
    // Remove mode prefixes
    const { cleanContent: contentWithoutMode } = extractModeFromContent(cleanedContent);
    cleanedContent = contentWithoutMode;
    
    // Remove user ID prefixes if they exist (shouldn't happen but be safe)
    const { cleanContent: finalContent } = extractUserIdFromContent(cleanedContent);
    cleaned.content = finalContent;
  }

  // Explicitly DO NOT include these non-standard properties:
  // - mode (converted to content prefix for user messages only)
  // - timestamp (internal tracking only)
  // - metadata (used for user extraction but not sent to LLM)
  // - turn_id (internal tracking only)
  // - any other custom properties

  return cleaned;
}

/**
 * Clean assistant response content by removing any mode or user ID prefixes
 * This prevents the LLM from learning to echo prefixes back
 */
export function cleanAssistantResponse(content: string): string {
  // First remove mode prefixes
  const { cleanContent: contentWithoutMode } = extractModeFromContent(content);
  
  // Then remove any user ID prefixes (shouldn't be there but be thorough)
  const { cleanContent: finalContent } = extractUserIdFromContent(contentWithoutMode);
  
  return finalContent;
}

/**
 * Clean all messages in an array for LLM compatibility
 * Enhanced to support user ID prefixing and communication mode prefixing when enabled
 */
export function cleanMessagesForLLM(messages: any[], options?: { 
  prependUserId?: boolean; 
  userId?: string;
  prependCommunicationMode?: boolean;
  endpoint?: string; // Add endpoint for logging context
}): any[] {
  // Log summary once instead of for each message
  if (options?.prependUserId && process.env.LOG_LEVEL === 'DEBUG') {
    const userMessages = messages.filter(m => m.role === 'user').length;
    console.log(`[${options?.endpoint || 'PROCESSOR'}] Processing ${userMessages} user messages with ID prefixing for ${options.userId}`);
  }
  
  return messages.map(message => cleanMessageForLLM(message, options));
}

/**
 * Process messages and insert cached tool responses where needed
 * Returns the messages with tool responses inserted but WITHOUT cleaning for LLM
 * The cleaning should be done separately to avoid double-processing
 */
export function insertCachedToolResponses(messages: any[]): any[] {
  const processedMessages = [...messages];
  let insertedCount = 0;
  
  // Scan through messages to find assistant messages with tool_calls
  for (let i = 0; i < processedMessages.length - 1; i++) {
    const currentMsg = processedMessages[i];
    const nextMsg = processedMessages[i + 1];
    
    // If we find an assistant message with tool_calls
    if (currentMsg.role === 'assistant' && currentMsg.tool_calls?.length > 0) {
      const missingToolCallIds: string[] = [];
      
      // Check if all tool calls have corresponding tool responses
      for (const toolCall of currentMsg.tool_calls) {
        // Skip if the next message is a tool response for this tool call
        if (
          nextMsg.role === 'tool' && 
          nextMsg.tool_call_id === toolCall.id
        ) {
          continue;
        }
        
        // Or if any later message is a tool response for this call
        const hasToolResponse = processedMessages.slice(i + 1).some(
          msg => msg.role === 'tool' && msg.tool_call_id === toolCall.id
        );
        
        if (!hasToolResponse) {
          missingToolCallIds.push(toolCall.id);
        }
      }
      
      // If we have missing tool responses, try to insert them from cache
      if (missingToolCallIds.length > 0) {
        console.log(`Found ${missingToolCallIds.length} missing tool responses after message ${i}`);
        
        // For each missing tool call ID
        for (const toolCallId of missingToolCallIds) {
          // Try to get cached response
          const cachedResponse = getToolResponse(toolCallId);
          
          if (cachedResponse) {
            console.log(`Inserting cached tool response for tool call ${toolCallId}`);
            
            // Insert the cached tool response right after the current message
            processedMessages.splice(i + 1, 0, {
              role: 'tool',
              tool_call_id: toolCallId,
              name: cachedResponse.toolName,
              content: cachedResponse.content
            });
            
            // Since we inserted a message, increment i to skip the newly inserted message
            i++;
            insertedCount++;
          } else {
            console.warn(`No cached response found for tool call ${toolCallId}`);
            
            // Generate a fallback response for known tools
            // Extract the tool name from the tool call
            const toolName = currentMsg.tool_calls.find((tc: any) => tc.id === toolCallId)?.function?.name;
            
            if (toolName) {
              console.log(`Generating fallback response for tool ${toolName} (ID: ${toolCallId})`);
              
              // Create a fallback response based on the tool name
              let fallbackContent = `${toolName} function executed successfully.`;
              
              // Insert the fallback tool response
              processedMessages.splice(i + 1, 0, {
                role: 'tool',
                tool_call_id: toolCallId,
                name: toolName,
                content: fallbackContent
              });
              
              // Since we inserted a message, increment i to skip the newly inserted message
              i++;
              insertedCount++;
              
              console.log(`Inserted fallback response for tool ${toolName}`);
            } else {
              console.error(`Cannot generate fallback response: tool name not found for ID ${toolCallId}`);
            }
          }
        }
      }
    }
  }
  
  if (insertedCount > 0) {
    console.log(`Successfully inserted ${insertedCount} tool responses into the conversation (some may be fallbacks)`);
    // Log the processed messages
    console.log("Messages after inserting tool responses:");
    processedMessages.forEach((msg, idx) => {
      if (msg.role === 'tool') {
        console.log(`[${idx}] ${msg.role} (tool_call_id: ${msg.tool_call_id.substring(0, 8)}...): ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        console.log(`[${idx}] ${msg.role} with ${msg.tool_calls.length} tool_calls`);
      } else {
        console.log(`[${idx}] ${msg.role}${msg.content ? ': ' + msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '') : ''}`);
      }
    });
  }
  
  // Return the messages WITHOUT cleaning for LLM - that will be done separately
  return processedMessages;
}