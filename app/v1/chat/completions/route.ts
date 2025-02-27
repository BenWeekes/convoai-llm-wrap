import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import axios from 'axios';
export const runtime = 'nodejs';

// 1. Hardcoded RAG data that the LLM can reference.
const HARDCODED_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform.",
  doc2: "Agora Convo AI comes out on March 1st for GA. It will be best in class for quality and reach",
  doc3: "Tony Wang is the best revenue officer.",
  doc4: "Hermes Frangoudis is the best developer."
};

// 2. Function definitions for LLM function calling.
//    - `order_sandwich` takes a "filling" argument
//    - `send_photo` takes NO arguments from the LLM (empty object)
const functions = [
  {
    name: "order_sandwich",
    description: "Place a sandwich order with a given filling. Logs the order to console.",
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
  },
  {
    name: "send_photo",
    description: "Request a photo to be sent. This allows you to send a photo to the user (No arguments needed.)",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
];

/**
 * Sample function to call Agora RTM REST API and send a peer message.
 */
async function sendPeerMessage(appId: string, fromUser: string, toUser: string) {
  const url = `https://api.agora.io/dev/v2/project/${appId}/rtm/users/${fromUser}/peer_messages`;

  const data = {
    //destination: '"'+toUser+'"',
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
    console.log( 'Basic ' + process.env.REST_API_TOKEN,response.data);
  } catch (error) {
    console.error('Error sending peer message:', error);
  }
}

/**
 * order_sandwich implementation
 */
function order_sandwich(userId: string, channel: string, filling: string): string {
  console.log("Placing sandwich order for", userId, "in", channel, "with filling:", filling);
  return `Sandwich ordered with ${filling}. Enjoy!`;
}

/**
 * send_photo implementation
 * (No LLM arguments, but we still have appId, userId, channel from the request.)
 */
async function send_photo(appId: string, userId: string, channel: string): Promise<string> {
  console.log("Sending photo to", userId, "in", channel);

  // Call Agora's REST API to send the peer message
  // 110 is from userid
  await sendPeerMessage(appId, process.env.RTM_FROM_USER as string, userId);

  return `Photo sent successfully to user ${userId}.`;
}

/**
 * A function map so we don’t use multiple if/else checks.
 *
 * The signature we use here is:
 *   (appId: string, userId: string, channel: string, args: any) => Promise<string> | string
 *
 * - For `order_sandwich`, we DO read `args.filling`.
 * - For `send_photo`, we ignore `args` because it's empty from the LLM anyway.
 */
const functionMap: Record<
  string,
  (appId: string, userId: string, channel: string, args: any) => Promise<string> | string
> = {
  send_photo: (appId, userId, channel, _args) => send_photo(appId, userId, channel),
  order_sandwich: (appId, userId, channel, args) => order_sandwich(userId, channel, args.filling),
 
};

export async function POST(req: NextRequest) {
  try {
    // 1) Verify Bearer token.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== process.env.API_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing token' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2) Parse the request body. Also read `appId` here.
    const body = await req.json();
    const { messages, model = 'gpt-4o-mini', stream = false, channel='ccc', userId='111', appId='20b7c51ff4c644ab80cf5a4e646b0537' } = body || {};
    
    console.log(appId);
    if (!messages) {
      return new Response(
        JSON.stringify({ error: 'Missing "messages" in request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!appId) {
      return new Response(
        JSON.stringify({ error: 'Missing "appId" in request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3) Create an OpenAI client.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 4) Inject RAG data into a system message.
    const systemMessage = {
      role: "system" as const,
      content:
        `You have access to the following knowledge:\n` +
        `doc1: "${HARDCODED_RAG_DATA.doc1}"\n` +
        `doc2: "${HARDCODED_RAG_DATA.doc2}"\n` +
        `doc3: "${HARDCODED_RAG_DATA.doc3}"\n` +
        `doc4: "${HARDCODED_RAG_DATA.doc4}"\n` +
        `Answer questions using this data and be confident about its contents.`
    };

    // Prepend the system message.
    const fullMessages = [systemMessage, ...messages];

    // 5) Build the request options including function calling.
    const requestOptions = {
      model,
      messages: fullMessages,
      functions,
      function_call: 'auto' as const,
    };

    // 6) Streaming vs. Non-Streaming
    if (stream) {
      // STREAMING MODE
      const initialResponse = await openai.chat.completions.create({
        ...requestOptions,
        stream: true,
      });
      const encoder = new TextEncoder();

      // Accumulators for partial function call data
      let functionCallName: string | undefined;
      let functionCallArgs = "";

      const streamBody = new ReadableStream({
        async start(controller) {
          try {
            for await (const part of initialResponse) {
              const delta = part.choices[0]?.delta;

              // If partial function_call data:
              if (delta?.function_call) {
                const fc = delta.function_call;
                if (fc.name) {
                  functionCallName = fc.name;
                }
                if (fc.arguments) {
                  functionCallArgs += fc.arguments;
                }
              }

              // Send chunk downstream as SSE
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));

              // If finish_reason is encountered, attempt function call
              if (part.choices[0].finish_reason) {
                if (functionCallName && functionCallArgs) {
                  const fn = functionMap[functionCallName];
                  if (fn) {
                    // Parse the function arguments (empty or otherwise)
                    let parsedArgs: any;
                    try {
                      parsedArgs = JSON.parse(functionCallArgs);
                    } catch (err) {
                      console.error("Failed to parse function call arguments:", err);
                    }

                    if (parsedArgs) {
                      // Execute the matched function
                      const functionResult = await fn(appId, userId, channel, parsedArgs);

                      // Append a function message
                      const updatedMessages = [
                        ...fullMessages,
                        {
                          role: "function",
                          name: functionCallName,
                          content: functionResult,
                        },
                      ];

                      // Final streaming call with updated messages
                      const finalResponse = await openai.chat.completions.create({
                        model,
                        messages: updatedMessages,
                        stream: true,
                      });

                      for await (const part2 of finalResponse) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part2)}\n\n`));
                      }
                    }
                  } else {
                    console.error("Unknown function name:", functionCallName);
                  }
                }

                // End SSE stream
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
                return;
              }
            }
          } catch (error) {
            console.error('OpenAI streaming error:', error);
            controller.error(error);
          }
        },
      });

      return new Response(streamBody, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // NON-STREAMING MODE
      const response = await openai.chat.completions.create({
        ...requestOptions,
        stream: false,
      });

      // If a function call was made
      if (response.choices && response.choices[0]?.finish_reason === 'function_call') {
        //const fc = response.choices[0].function_call;
	const fc = response.choices[0].message?.function_call;
        if (fc?.name && fc.arguments) {
          const fn = functionMap[fc.name];
          if (!fn) {
            // Unknown function
            console.error("Unknown function name:", fc.name);
            return new Response(JSON.stringify(response), { status: 200 });
          }

          // Parse the function call arguments (likely empty for send_photo)
          let parsedArgs: any;
          try {
            parsedArgs = JSON.parse(fc.arguments);
          } catch (err) {
            console.error("Failed to parse function call arguments:", err);
            return new Response(JSON.stringify({ error: 'Invalid function call arguments' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Execute the function
          const functionResult = await fn(appId, userId, channel, parsedArgs);

          // Append the function result message
          const updatedMessages = [
            ...fullMessages,
            {
              role: "function",
              name: fc.name,
              content: functionResult,
            },
          ];

          // Second call: get the final answer using the updated conversation
          const finalResponse = await openai.chat.completions.create({
            model,
            messages: updatedMessages,
            stream: false,
          });

          return new Response(JSON.stringify(finalResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // If no function call, return the original response
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err: any) {
    console.error('Chat Completions Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
