import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import axios from 'axios';

export const runtime = 'nodejs';

// -----------------------------------------------------------------------------
// Configuration options
// -----------------------------------------------------------------------------
const CONFIG = {
  // Set to false to disable detailed response logging (reduces console output)
  enableDetailedResponseLogging: true,
  // Cache expiration time in milliseconds (24 hours)
  cacheExpirationMs: 86400000,
  // Interval for cleaning up expired cache entries (1 minute)
  cleanupIntervalMs: 60000
};

// -----------------------------------------------------------------------------
// Add an in-memory cache for tool responses with expiration
// -----------------------------------------------------------------------------
type ToolResponseCacheItem = {
  toolCallId: string;
  toolName: string;
  content: string;
  timestamp: number;
};

// Global cache to store tool responses (will be shared across requests)
const toolResponseCache: Record<string, ToolResponseCacheItem> = {};

// Cache management functions
function storeToolResponse(toolCallId: string, toolName: string, content: string): void {
  toolResponseCache[toolCallId] = {
    toolCallId,
    toolName,
    content,
    timestamp: Date.now()
  };
}

function getToolResponse(toolCallId: string): ToolResponseCacheItem | null {
  const item = toolResponseCache[toolCallId];
  if (!item) return null;
  
  // Check if item has expired
  if (Date.now() - item.timestamp > CONFIG.cacheExpirationMs) {
    // Remove expired item
    delete toolResponseCache[toolCallId];
    return null;
  }
  
  return item;
}

// This runs every minute to proactively clean the cache
function cleanupExpiredResponses(): void {
  const now = Date.now();
  let expiredCount = 0;
  
  Object.keys(toolResponseCache).forEach(key => {
    if (now - toolResponseCache[key].timestamp > CONFIG.cacheExpirationMs) {
      delete toolResponseCache[key];
      expiredCount++;
    }
  });
  
  if (expiredCount > 0) {
    console.log(`Cleaned up ${expiredCount} expired tool response entries from cache`);
  }
}

// Schedule cleanup at the specified interval
setInterval(cleanupExpiredResponses, CONFIG.cleanupIntervalMs);

// Helper for debugging the cache
function logCacheState(): void {
  console.log("Current Tool Response Cache State:");
  console.log(`Total cached items: ${Object.keys(toolResponseCache).length}`);
  
  if (Object.keys(toolResponseCache).length > 0) {
    Object.values(toolResponseCache).forEach(item => {
      const ageInHours = (Date.now() - item.timestamp) / 3600000;
      console.log(`- ID: ${item.toolCallId.substring(0, 8)}..., Tool: ${item.toolName}, Age: ${ageInHours.toFixed(2)} hours`);
    });
  }
}

// -----------------------------------------------------------------------------
// Helper: Safe JSON Parse
// -----------------------------------------------------------------------------
function safeJSONParse(jsonStr: string): any {
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

// -----------------------------------------------------------------------------
// 1) Hardcoded RAG data
// -----------------------------------------------------------------------------
const HARDCODED_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform.",
  doc2: "Agora Convo AI comes out on March 1st for GA. It will be best in class for quality and reach",
  doc3: "Tony Wang is the best revenue officer.",
  doc4: "Hermes Frangoudis is the best developer."
};

// -----------------------------------------------------------------------------
// 2) Tools definitions that match ChatCompletionTool shape
// -----------------------------------------------------------------------------
const tools: OpenAI.ChatCompletionTool[] = [
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
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Type of photo subject (e.g. 'face', 'full_body', 'landscape')"
          }
        },
        required: ["subject"]
      }
    }
  }
];

// -----------------------------------------------------------------------------
// 3) Implement the actual tool logic
// -----------------------------------------------------------------------------
async function sendPeerMessage(appId: string, fromUser: string, toUser: string) {
  const url = `https://api.agora.io/dev/v2/project/${appId}/rtm/users/${fromUser}/peer_messages`;
  const data = {
    destination: String(toUser),
    enable_offline_messaging: true,
    enable_historical_messaging: true,
    payload: '{"img":"https://sa-utils.agora.io/mms/kierap.png"}'
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        Authorization: 'Basic ' + process.env.REST_API_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    console.log('sendPeerMessage response:', response.data);
  } catch (error) {
    console.error('Error sending peer message:', error);
  }
}

function order_sandwich(userId: string, channel: string, filling: string): string {
  console.log("Placing sandwich order for", userId, "in", channel, "with filling:", filling);
  return `Sandwich ordered with ${filling}. It will arrive at 3pm. Enjoy!`;
}

async function send_photo(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const subject = args.subject || "default";
  console.log(`Sending ${subject} photo to ${userId} in ${channel}`);
  await sendPeerMessage(appId, process.env.RTM_FROM_USER as string, userId);
  return `Photo of ${subject} sent successfully.`;
}

// Helper: generate unique call ID
function generateCallId(): string {
  return "call_" + Math.random().toString(36).slice(2, 8);
}

// A map so we can call each tool by name
const toolMap: Record<
  string,
  (appId: string, userId: string, channel: string, args: any) => Promise<string> | string
> = {
  order_sandwich: (_appId, userId, channel, args) =>
    order_sandwich(userId, channel, args.filling),
  send_photo: (appId, userId, channel, args) =>
    send_photo(appId, userId, channel, args),
};

// -----------------------------------------------------------------------------
// Logging utilities
// -----------------------------------------------------------------------------

/**
 * Logs the full response in a nice, boxed format if detailed logging is enabled
 */
function logFullResponse(type: string, data: any): void {
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

// -----------------------------------------------------------------------------
// Model-specific handling
// -----------------------------------------------------------------------------

// Additional safety check to determine if a model might need different handling
function modelRequiresSpecialHandling(model: string): boolean {
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

// Special handling for Llama/Trulience models experiencing 400 errors
function isFollowUpWithToolResponsesPresent(messages: any[]): boolean {
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

// For Llama models, simplify messages for second turn after tool call
function simplifyMessagesForLlama(messages: any[]): any[] {
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

// -----------------------------------------------------------------------------
// Error handling: Try to recover from common errors
// -----------------------------------------------------------------------------
async function handleModelRequest(openai: OpenAI, params: any, fallbackModel = 'gpt-3.5-turbo'): Promise<any> {
  try {
    // Try to make the request with the original model and parameters
    return await openai.chat.completions.create(params);
  } catch (error: any) {
    // Log the error for debugging
    console.error(`Error making request with model ${params.model}:`, error.message || 'Unknown error');
    
    // Special handling for Llama models
    if (typeof params.model === 'string' && 
        (params.model.toLowerCase().includes('llama') || params.model.toLowerCase().includes('trulience'))) {
      // For Llama models, keep tools but try with a simpler configuration
      try {
        console.log(`Attempting retry with Llama-specific configuration...`);
        
        // Create a deep clone of the parameters to avoid modifying original
        const llamaParams = JSON.parse(JSON.stringify(params));
        
        // Check if this is a follow-up after tool use and simplify if needed
        if (isFollowUpWithToolResponsesPresent(llamaParams.messages)) {
          llamaParams.messages = simplifyMessagesForLlama(llamaParams.messages);
        }
        // Otherwise check if we need to simplify the message history due to length
        else if (llamaParams.messages.length > 10) {
          console.log(`Message history is long (${llamaParams.messages.length}), truncating...`);
          // Keep the most recent messages
          const systemMessages = llamaParams.messages.filter((m: any) => m.role === 'system');
          const nonSystemMessages = llamaParams.messages.filter((m: any) => m.role !== 'system');
          // Take last 8 non-system messages
          const recentMessages = nonSystemMessages.slice(-8);
          llamaParams.messages = [...systemMessages, ...recentMessages];
        }
        
        return await openai.chat.completions.create(llamaParams);
      } catch (llamaError: any) {
        console.error(`Llama-specific retry failed:`, llamaError.message || 'Unknown error');
        
        // Last resort: Try without tools for Llama
        try {
          console.log(`Attempting last resort for Llama: no tools, simplified conversation...`);
          const lastResortParams = JSON.parse(JSON.stringify(params));
          
          // Find system messages and the last user message
          const systemMessages = lastResortParams.messages.filter((m: any) => m.role === 'system');
          const lastUserMessage = [...lastResortParams.messages].reverse().find((m: any) => m.role === 'user');
          
          if (lastUserMessage) {
            lastResortParams.messages = [...systemMessages, lastUserMessage];
            lastResortParams.tools = undefined;
            lastResortParams.tool_choice = undefined;
            
            return await openai.chat.completions.create(lastResortParams);
          }
        } catch (lastResortError) {
          console.error(`Last resort for Llama failed:`, lastResortError);
        }
        
        throw error; // Re-throw the original error if all Llama-specific approaches fail
      }
    }
    
    // If it's a 400 error for other models, try different approaches
    if (error.status === 400) {
      // Option 1: Try removing tool configuration if it's causing issues
      try {
        console.log(`Attempting fallback without tools...`);
        const noToolsParams = { ...params };
        // Only set these to undefined, don't delete them to avoid TypeScript errors
        noToolsParams.tools = undefined;
        noToolsParams.tool_choice = undefined;
        
        return await openai.chat.completions.create(noToolsParams);
      } catch (fallbackError: any) {
        console.error(`Fallback without tools failed:`, fallbackError.message || 'Unknown error');
        
        // Option 2: Try with a different model
        try {
          console.log(`Attempting with fallback model ${fallbackModel}...`);
          const fallbackModelParams = { ...params, model: fallbackModel };
          
          return await openai.chat.completions.create(fallbackModelParams);
        } catch (modelFallbackError: any) {
          console.error(`Fallback model failed:`, modelFallbackError.message || 'Unknown error');
          // Re-throw the original error if all fallbacks fail
          throw error;
        }
      }
    } else {
      // For other types of errors, just re-throw
      throw error;
    }
  }
}

// -----------------------------------------------------------------------------
// Helper: Process and check messages for missing tool responses
// -----------------------------------------------------------------------------
function insertCachedToolResponses(messages: any[]): any[] {
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
              let fallbackContent = "";
              
              if (toolName === 'send_photo') {
                fallbackContent = "Photo of face sent successfully.";
              } else if (toolName === 'order_sandwich') {
                fallbackContent = "Sandwich ordered with cheese. It will arrive at 3pm. Enjoy!";
              } else {
                fallbackContent = `${toolName} function executed successfully.`;
              }
              
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

// Type definition for Request
type RequestWithJson = Request & {
  json: () => Promise<any>;
};

// -----------------------------------------------------------------------------
// 4) The Next.js route handler
// -----------------------------------------------------------------------------
export async function POST(req: RequestWithJson) {
  try {
    // A) Validate token
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== process.env.API_TOKEN) {
      const errorResponse = { error: 'Invalid or missing token' };
      logFullResponse("ERROR-403", errorResponse);
      return NextResponse.json(errorResponse, { status: 403 });
    }

    // B) Parse request
    const body = await req.json();
    const {
      messages,
      model = 'gpt-4o-mini',
      baseURL = 'https://api.openai.com/v1',
      stream = true, // boolean
      channel = 'ccc',
      userId = '111',
      appId = '',
      stream_options = {}
    } = body || {};

    console.log('body');
    console.dir(body, { depth: null, colors: true });
    
    // Log the current state of the cache for debugging
    logCacheState();
    
    if (!messages || !Array.isArray(messages)) {
      const errorResponse = { error: 'Missing or invalid "messages" in request body' };
      logFullResponse("ERROR-400", errorResponse);
      return NextResponse.json(errorResponse, { status: 400 });
    }
    if (!appId) {
      const errorResponse = { error: 'Missing "appId" in request body' };
      logFullResponse("ERROR-400", errorResponse);
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // C) Create OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL
    });

    // D) Inject RAG data
    const systemMessage = {
      role: "system" as const,
      content: `
        You have access to the following knowledge:
        doc1: "${HARDCODED_RAG_DATA.doc1}"
        doc2: "${HARDCODED_RAG_DATA.doc2}"
        doc3: "${HARDCODED_RAG_DATA.doc3}"
        doc4: "${HARDCODED_RAG_DATA.doc4}"
        
        When you receive information from tools like order_sandwich or send_photo, 
        make sure to reference specific details from their responses in your replies.
        
        Answer questions using this data and be confident about its contents.
      `
    };
    
    // Process messages and insert cached tool responses if needed
    const processedMessages = insertCachedToolResponses(messages);
    
    // Check if this is a Llama/Trulience model and if we need to simplify the conversation
    let finalMessages;
    if ((typeof model === 'string' && 
        (model.toLowerCase().includes('llama') || model.toLowerCase().includes('trulience'))) &&
        isFollowUpWithToolResponsesPresent(processedMessages)) {
      
      // Use a simplified message history for Llama models on the second turn
      finalMessages = [systemMessage, ...simplifyMessagesForLlama(processedMessages)];
    } else {
      finalMessages = [systemMessage, ...processedMessages];
    }

    // E) Define request parameters
    const requestParams: any = {
      model,
      messages: finalMessages,
      stream: false
    };

    // Special handling for Llama models - keep tools but adjust parameters if needed
    if (typeof model === 'string' && 
        (model.toLowerCase().includes('llama') || model.toLowerCase().includes('trulience'))) {
      console.log(`Detected Llama/Trulience model: ${model}`);
      // We'll keep tools but handle any errors with the specific Llama retry logic
      requestParams.tools = tools;
      requestParams.tool_choice = "auto";
    } 
    // For other models that might need special handling
    else if (modelRequiresSpecialHandling(model)) {
      console.log(`Model ${model} may require special handling. Simplifying request...`);
      // For non-OpenAI models, we won't include tools
    } else {
      // For standard OpenAI models, include tools
      requestParams.tools = tools;
      requestParams.tool_choice = "auto";
    }

    console.info('stream', stream);
    console.dir(requestParams, { depth: null, colors: true });

    // F) Call the LLM
    if (stream) {
      try {
        // Set up streaming parameters
        const streamParams = { ...requestParams, stream: true };
        
        // Make the request with error handling
        const streamingResponse = await handleModelRequest(openai, streamParams);

        // G) For streaming, process async iterator of ChatCompletionChunk
        const encoder = new TextEncoder();

        // We'll merge partial tool call fragments into a single object.
        let accumulatedToolCall: any = null;
        let toolExecuted = false; // ensure we process the tool only once
        let controllerClosed = false; // Flag to track if controller is closed
        
        // Track chunks sent to client for logging
        const completeResponse: any[] = [];

        const streamBody = new ReadableStream({
          async start(controller) {
            try {
              for await (const part of streamingResponse) {
                // Skip if controller is closed
                if (controllerClosed) continue;
                
                const chunk = part.choices?.[0];
                const delta = chunk?.delta;

                // Merge any partial tool_calls
                if (delta?.tool_calls) {
                  for (const tCall of delta.tool_calls) {
                    if (!accumulatedToolCall || (tCall.function?.name && accumulatedToolCall.function?.name && tCall.function.name !== accumulatedToolCall.function.name)) {
                      accumulatedToolCall = tCall;
                      if (!accumulatedToolCall.id) {
                        accumulatedToolCall.id = generateCallId();
                      }
                      if (typeof accumulatedToolCall.index !== "number") {
                        accumulatedToolCall.index = 0;
                      }
                      if (!accumulatedToolCall.type) {
                        accumulatedToolCall.type = "function";
                      }
                      if (!accumulatedToolCall.function) {
                        accumulatedToolCall.function = {};
                      }
                    } else {
                      // Otherwise merge fragments
                      if (tCall.function) {
                        if (tCall.function.name) {
                          accumulatedToolCall.function.name = tCall.function.name;
                        }
                        if (tCall.function.arguments) {
                          if (accumulatedToolCall.function.arguments) {
                            accumulatedToolCall.function.arguments += tCall.function.arguments;
                          } else {
                            accumulatedToolCall.function.arguments = tCall.function.arguments;
                          }
                        }
                      }
                    }
                  }
                }

                // Store everything for comprehensive response logging
                completeResponse.push({
                  type: "initial_stream",
                  data: part
                });

                // Stream current chunk out
                const dataString = `data: ${JSON.stringify(part)}\n\n`;
                controller.enqueue(encoder.encode(dataString));

                // When finish_reason is reached, process tool call only once
                if (chunk?.finish_reason && !toolExecuted) {
                  toolExecuted = true;
                  if (accumulatedToolCall) {
                    // Ensure nested function object has a name
                    if (!accumulatedToolCall.function || !accumulatedToolCall.function.name) {
                      console.error("Accumulated tool call is missing function.name.");
                    } else {
                      const callName = accumulatedToolCall.function.name;
                      const callArgsStr = accumulatedToolCall.function.arguments || "{}";
                      const fn = toolMap[callName];
                      if (fn) {
                        let parsedArgs: any = {};
                        try {
                          parsedArgs = safeJSONParse(callArgsStr);
                        } catch (err) {
                          console.error("Failed to parse tool call arguments:", err);
                        }
                        console.log(
                          `Calling ${callName} for ${userId} in ${channel} with args:`,
                          JSON.stringify(parsedArgs)
                        );
                        
                        // Append an assistant message with valid tool_calls
                        const updatedMessages = [
                          ...finalMessages,
                          {
                            role: "assistant",
                            content: "",
                            tool_calls: [accumulatedToolCall]
                          }
                        ];
                        
                        // Execute the tool function
                        const toolResult = await fn(appId, userId, channel, parsedArgs);
                        console.log(`Tool result: ${toolResult}`);

                        // Store the tool response in the cache
                        storeToolResponse(accumulatedToolCall.id, callName, toolResult);
                        console.log(`Cached tool response for call ID: ${accumulatedToolCall.id}`);
                        
                        // Store tool execution in the response log
                        completeResponse.push({
                          type: "tool_execution",
                          tool_name: callName,
                          arguments: parsedArgs,
                          result: toolResult
                        });
                        
                        // Append a tool message referencing the same call id
                        updatedMessages.push({
                          role: "tool",
                          name: callName,
                          content: toolResult,
                          tool_call_id: accumulatedToolCall.id
                        });
                        
                        // Final streaming call with updated conversation
                        try {
                          const finalStreamParams: any = {
                            model,
                            messages: updatedMessages,
                            stream: true
                          };

                          // Add tools if appropriate for the model
                          if (!modelRequiresSpecialHandling(model)) {
                            finalStreamParams.tools = tools;
                            finalStreamParams.tool_choice = "auto";
                          }

                          const finalResponse = await handleModelRequest(openai, finalStreamParams);
                          
                          for await (const part2 of finalResponse) {
                            if (controllerClosed) break; // Skip if controller is closed
                            
                            // Store for comprehensive logging
                            completeResponse.push({
                              type: "final_stream",
                              data: part2
                            });
                            
                            const dataString2 = `data: ${JSON.stringify(part2)}\n\n`;
                            controller.enqueue(encoder.encode(dataString2));
                          }
                        } catch (streamErr) {
                          console.error("Error in final response stream:", streamErr);
                          completeResponse.push({
                            type: "error",
                            source: "final_stream",
                            error: streamErr instanceof Error ? streamErr.message : "Unknown error"
                          });
                        }
                      } else {
                        console.error("Unknown tool name:", callName);
                        completeResponse.push({
                          type: "error",
                          error: `Unknown tool name: ${callName}`
                        });
                      }
                    }
                  }
                  
                  // End SSE - make sure we only do this once
                  if (!controllerClosed) {
                    const doneString = `data: [DONE]\n\n`;
                    controller.enqueue(encoder.encode(doneString));
                    completeResponse.push({
                      type: "stream_end",
                      marker: "[DONE]"
                    });
                    controllerClosed = true;
                    controller.close();
                    
                    // Log the complete response
                    logFullResponse("STREAM WITH TOOL", completeResponse);
                  }
                  return;
                }
              }
              
              // Normal end of stream if no tool call was processed
              if (!controllerClosed) {
                const doneString = `data: [DONE]\n\n`;
                controller.enqueue(encoder.encode(doneString));
                completeResponse.push({
                  type: "stream_end",
                  marker: "[DONE]"
                });
                controllerClosed = true;
                controller.close();
                
                // Log the complete response
                logFullResponse("STREAM WITHOUT TOOL", completeResponse);
              }
            } catch (error) {
              console.error("OpenAI streaming error:", error);
              // Only try to send an error if the controller isn't closed
              if (!controllerClosed) {
                try {
                  const errorMessage = error instanceof Error ? error.message : "Unknown streaming error";
                  const errorData = { error: errorMessage };
                  completeResponse.push({
                    type: "error",
                    error: errorMessage
                  });
                  controller.error(error);
                  controllerClosed = true;
                  
                  // Log the error response
                  logFullResponse("STREAM ERROR", completeResponse);
                } catch (controllerErr) {
                  console.error("Error while sending error to controller:", controllerErr);
                }
              }
            }
          }
        });

        const response = new Response(streamBody, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        });
        // Note: We keep using Response for streaming since NextResponse.json doesn't support streaming
        
        return response;
      } catch (error) {
        console.error("Stream setup error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown streaming setup error";
        const errorResponse = { error: errorMessage };
        
        // Log the error response
        logFullResponse("STREAM SETUP ERROR", errorResponse);
        
        return NextResponse.json(errorResponse, { status: 500 });
      }
    } else {
      // For non-streaming, call with stream: false explicitly
      try {
        const nonStreamingResponse = await handleModelRequest(openai, requestParams);
        
        // Log the complete non-streaming response
        logFullResponse("NON-STREAM", nonStreamingResponse);
        
        return NextResponse.json(nonStreamingResponse, { status: 200 });
      } catch (error) {
        throw error; // Let the outer catch block handle it
      }
    }
  } catch (error: unknown) {
    console.error("Chat Completions Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    const errorResponse = { error: errorMessage };
    
    // Log the error response
    logFullResponse("ERROR", errorResponse);
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}