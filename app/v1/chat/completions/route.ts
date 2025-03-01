/**
 * Example: A Next.js route handler that uses the OpenAI "Tools" API,
 * with streaming or non-streaming logic in TypeScript. This version merges
 * partial tool call fragments (resetting if a new function name is seen) and
 * ensures the tool call is executed only once.
 */

import { NextRequest } from 'next/server';
import OpenAI, {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletion,
} from 'openai';
import axios from 'axios';

export const runtime = 'nodejs';

// -----------------------------------------------------------------------------
// Helper: Safe JSON Parse (unchanged)
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
const tools: ChatCompletionTool[] = [
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
      description: "Request a photo to be sent. Returns details about the photo sent.",
      parameters: {
        type: "object",
        properties: {},
        required: []
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

async function send_photo(appId: string, userId: string, channel: string): Promise<string> {
  console.log("Sending photo to", userId, "in", channel);
  await sendPeerMessage(appId, process.env.RTM_FROM_USER as string, userId);
  return `Photo of bikini sent successfully to user ${userId}.`;
}

// A map so we can call each tool by name
const toolMap: Record<
  string,
  (appId: string, userId: string, channel: string, args: any) => Promise<string> | string
> = {
  order_sandwich: (_appId, userId, channel, args) =>
    order_sandwich(userId, channel, args.filling),
  send_photo: (appId, userId, channel, _args) =>
    send_photo(appId, userId, channel),
};

// -----------------------------------------------------------------------------
// 4) The Next.js route handler
// -----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // A) Validate token
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== process.env.API_TOKEN) {
      return new Response(JSON.stringify({ error: 'Invalid or missing token' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // B) Parse request
    const body = await req.json();
    const {
      messages,
      model = 'gpt-4o-mini',
      baseURL = 'https://api.openai.com/v1',
      stream = false, // boolean
      channel = 'ccc',
      userId = '111',
      appId = '20b7c51ff4c644ab80cf5a4e646b0537',
    } = body || {};

    if (!messages) {
      return new Response(JSON.stringify({ error: 'Missing "messages" in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!appId) {
      return new Response(JSON.stringify({ error: 'Missing "appId" in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
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
    const fullMessages = [systemMessage, ...messages];

    // E) Define requestOptions based on stream flag
    let requestOptions:
      | ChatCompletionCreateParamsStreaming
      | ChatCompletionCreateParamsNonStreaming;

    if (stream) {
      requestOptions = {
        model,
        messages: fullMessages,
        tools,
        stream: true
      };
    } else {
      requestOptions = {
        model,
        messages: fullMessages,
        tools,
        stream: false
      };
    }

    // F) Call the LLM
    const initialResponse = await openai.chat.completions.create(requestOptions);

    // G) For non-streaming, return JSON response
    if (!stream) {
      return new Response(JSON.stringify(initialResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // H) For streaming, process async iterator of ChatCompletionChunk
    const encoder = new TextEncoder();

    // We'll merge partial tool call fragments into a single object.
    let accumulatedToolCall: any = null;
    let toolExecuted = false; // ensure we process the tool only once

    // Helper: generate unique call ID if needed.
    function generateCallId() {
      return "call_" + Math.random().toString(36).slice(2, 8);
    }

    const streamBody = new ReadableStream({
      async start(controller) {
        try {
          for await (const part of initialResponse) {
            const chunk = part.choices?.[0];
            const delta = chunk?.delta;

            // Merge any partial tool_calls
            if (delta?.tool_calls) {
              for (const tCall of delta.tool_calls) {
                // If accumulatedToolCall is null or this fragment's function name differs, reset it.
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

            // Stream current chunk out
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));

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
                      ...fullMessages,
                      {
                        role: "assistant",
                        content: "",
                        tool_calls: [accumulatedToolCall]
                      }
                    ];
                    // Execute the tool function
                    const toolResult = await fn(appId, userId, channel, parsedArgs);
                    console.log(`Tool result: ${toolResult}`); // Log to verify result content
                    
                    // Append a tool message referencing the same call id
                    updatedMessages.push({
                      role: "tool",
                      name: callName,
                      content: toolResult,
                      tool_call_id: accumulatedToolCall.id
                    });
                    
                    // Final streaming call with updated conversation
                    const finalRequest: ChatCompletionCreateParamsStreaming = {
                      model,
                      messages: updatedMessages,
                      tools,
                      stream: true
                    };
                    const finalResponse = await openai.chat.completions.create(finalRequest);
                    for await (const part2 of finalResponse) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(part2)}\n\n`));
                    }
                  } else {
                    console.error("Unknown tool name:", callName);
                  }
                }
              }
              // End SSE
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
              controller.close();
              return;
            }
          }
        } catch (err) {
          console.error("OpenAI streaming error:", err);
          controller.error(err);
        }
      }
    });

    return new Response(streamBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  } catch (err: any) {
    console.error("Chat Completions Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}