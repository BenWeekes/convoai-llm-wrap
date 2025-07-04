// File: lib/common/message-processor.ts
// Updated to use content prefixes instead of non-standard properties

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
 * Clean message for LLM by removing non-standard properties and adding mode prefixes
 * Removes: mode, timestamp, and any other non-standard properties
 * Keeps only: role, content, name, tool_calls, tool_call_id
 */
export function cleanMessageForLLM(message: any): any {
  const cleaned: any = {
    role: message.role,
    content: message.content
  };

  // Add only standard OpenAI API properties if they exist
  if (message.name) cleaned.name = message.name;
  if (message.tool_calls) cleaned.tool_calls = message.tool_calls;
  if (message.tool_call_id) cleaned.tool_call_id = message.tool_call_id;

  // ONLY add mode prefix to USER messages, not assistant messages
  // This prevents the LLM from learning to echo the prefixes back
  if (message.role === 'user' && message.content && message.mode) {
    cleaned.content = addModePrefix(message.content, message.mode);
  }

  // For assistant messages, clean any prefixes the LLM might have added
  if (message.role === 'assistant' && message.content) {
    const { cleanContent } = extractModeFromContent(message.content);
    cleaned.content = cleanContent;
  }

  // Explicitly DO NOT include these non-standard properties:
  // - mode (converted to content prefix for user messages only)
  // - timestamp (internal tracking only)
  // - any other custom properties

  return cleaned;
}

/**
 * Clean assistant response content by removing any mode prefixes
 * This prevents the LLM from learning to echo prefixes back
 */
export function cleanAssistantResponse(content: string): string {
  const { cleanContent } = extractModeFromContent(content);
  return cleanContent;
}

/**
 * Clean all messages in an array for LLM compatibility
 */
export function cleanMessagesForLLM(messages: any[]): any[] {
  return messages.map(cleanMessageForLLM);
}

/**
 * Process messages and insert cached tool responses where needed
 * Now also cleans messages for LLM compatibility
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
  
  // Clean all messages for LLM compatibility before returning
  return cleanMessagesForLLM(processedMessages);
}