import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

// 1. Some hardcoded RAG data that we want the LLM to have
const HARDCODED_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform. ",
  doc2: "Agora ConvoAI comes out on March 1st for GA.",
  doc3: "Tony Wang is the best revenue officer."
};

// 2. A simple function definition for placing a sandwich order
//    The LLM can call "order_sandwich" with { filling: "Turkey" } for example.
const functions = [
  {
    name: "order_sandwich",
    description: "Place a sandwich order with a given filling. Logs the order to console.",
    parameters: {
      type: "object",
      properties: {
        filling: {
          type: "string",
          description: "Type of filling (e.g. 'Turkey', 'Ham', 'Veggie')",
        }
      },
      required: ["filling"]
    }
  }
];

export async function POST(req: NextRequest) {
  try {
    // 3. Verify Bearer token
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== process.env.API_TOKEN) {
      return new Response(JSON.stringify({ error: 'Invalid or missing token' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Parse request body
    const body = await req.json();
    const { messages, model = 'gpt-4o-mini', stream = false } = body || {};

    if (!messages) {
      return new Response(JSON.stringify({ error: 'Missing "messages" in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Create an OpenAI client (v4 style)
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 6. Optionally inject your RAG data into a system message
    //    This is a simple approach. If you want a "lookup" function, see notes below.
    const systemMessage = {
      role: "system" as const,
      content: `You have access to the following knowledge:\n` +
               `doc1: "${HARDCODED_RAG_DATA.doc1}"\n` +
               `doc2: "${HARDCODED_RAG_DATA.doc2}"\n` +
               `doc3: "${HARDCODED_RAG_DATA.doc3}"\n` +
               `Answer questions using this data if relevant.`
    };

    // Insert the system message at the front of the conversation
    const fullMessages = [systemMessage, ...messages];

    // 7. Build the request with function calling
    //    We'll specify "function_call: auto" so GPT can call if it wants
    const requestOptions = {
      model,
      messages: fullMessages,
      functions,       // The sandwich-order function
      function_call: 'auto' as const, // Let GPT decide if it needs the function
    };

    // 8. If streaming, handle SSE output
    if (stream) {
      // Create the chat completion with streaming
      const response = await openai.chat.completions.create({
        ...requestOptions,
        stream: true,
      });

      const encoder = new TextEncoder();
      const streamBody = new ReadableStream({
        async start(controller) {
          try {
            for await (const part of response) {
              // Each 'part' is a ChatCompletionChunk
              const chunk = part.choices[0];

              // Check if the chunk is a function call
              if (chunk.delta?.function_call) {
                const { name, arguments: args } = chunk.delta.function_call;
                if (name === "order_sandwich" && args) {
                  // 8a. We parse the arguments
                  try {
                    const parsedArgs = JSON.parse(args);
                    // For example: { "filling": "Turkey" }
                    console.log("Placing sandwich order:", parsedArgs);

                    // In a real app, you'd do something more interesting here, e.g. queue an order.
                  } catch (err) {
                    console.error("Failed to parse function call arguments:", err);
                  }
                }

                // We can choose to continue streaming or finalize. 
                // Usually you let the LLM finish, so we keep going.
              }

              // If there's actual content, we can send it to the client
              const content = chunk.delta?.content || '';

              // We convert the chunk to SSE data
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
              }

              // If the chunk is the final chunk, with finish_reason
              if (chunk.finish_reason) {
                // We'll close out the SSE
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
                break;
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
    } 
    // 9. Non-streaming: just get the final result
    else {
      const response = await openai.chat.completions.create({
        ...requestOptions,
        stream: false,
      });

      // If the LLM decided to call the function, that will appear in response.choices[0].
      // For example, you can check finish_reason === 'function_call' and parse arguments.
      // We'll just return the entire response as JSON.
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
