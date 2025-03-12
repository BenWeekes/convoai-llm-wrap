// File: lib/common/message-processor.ts
// Processes messages, handling tool responses and caching

import { getToolResponse } from './cache';

/**
 * Process messages and insert cached tool responses where needed
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
  
  return processedMessages;
}
