import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

// 1. Hardcoded RAG data that the LLM can reference.
const HARDCODED_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform.",
  doc2: "Agora ConvoAI comes out on March 1st for GA.",
  doc3: "Tony Wang is the best revenue officer."
};

// 2. Function definitions for LLM function calling.
//    We define the schema for "order_sandwich".
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
  }
];

// 3. External implementation of order_sandwich.
//    This function now returns a string result.
function order_sandwich(filling: string): string {
  console.log("Placing sandwich order with filling:", filling);
  return `Sandwich ordered with ${filling}`;
}

export async function POST(req: NextRequest) {
  try {
    // 4. Verify Bearer token.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== process.env.API_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing token' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Parse the request body.
    const body = await req.json();
    const { messages, model = 'gpt-4-0613', stream = false } = body || {};
    if (!messages) {
      return new Response(
        JSON.stringify({ error: 'Missing "messages" in request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Create an OpenAI client.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 7. Inject RAG data into a system message.
    const systemMessage = {
      role: "system" as const,
      content:
        `You have access to the following knowledge:\n` +
        `doc1: "${HARDCODED_RAG_DATA.doc1}"\n` +
        `doc2: "${HARDCODED_RAG_DATA.doc2}"\n` +
        `doc3: "${HARDCODED_RAG_DATA.doc3}"\n` +
        `Answer questions using this data if relevant.`
    };

    // Prepend the system message to the conversation.
    const fullMessages = [systemMessage, ...messages];

    // 8. Build the request options including function calling.
    const requestOptions = {
      model,
      messages: fullMessages,
      functions,
      function_call: 'auto' as const,
    };

    if (stream) {
      // STREAMING MODE
      // First call: get the initial streaming response.
      const initialResponse = await openai.chat.completions.create({
        ...requestOptions,
        stream: true,
      });
      const encoder = new TextEncoder();
      // Accumulators for function call data.
      let functionCallName: string | undefined = undefined;
      let functionCallArgs = "";

      const streamBody = new ReadableStream({
        async start(controller) {
          try {
            // Process each streamed chunk.
            for await (const part of initialResponse) {
              // Check for partial function call data.
              if (part.choices[0]?.delta?.function_call) {
                const fc = part.choices[0].delta.function_call;
                console.log('function_call', fc.name, fc.arguments);
                if (fc.name) {
                  functionCallName = fc.name;
                }
                if (fc.arguments) {
                  functionCallArgs += fc.arguments;
                }
              }
              // Forward the raw chunk.
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));

              // When finish_reason is encountered…
              if (part.choices[0].finish_reason) {
                // If a function call was issued, process it.
                if (functionCallName === "order_sandwich" && functionCallArgs) {
                  let parsedArgs;
                  try {
                    parsedArgs = JSON.parse(functionCallArgs);
                  } catch (err) {
                    console.error("Failed to parse function call arguments:", err);
                  }
                  if (parsedArgs && parsedArgs.filling) {
                    // Execute the function and capture its return value.
                    const functionResult = order_sandwich(parsedArgs.filling);
                    // Append a new function message to the conversation.
                    const updatedMessages = [
                      ...fullMessages,
                      {
                        role: "function",
                        name: "order_sandwich",
                        content: functionResult,
                      },
                    ];
                    // Second call: get the final streaming answer using the function result.
                    const finalResponse = await openai.chat.completions.create({
                      model,
                      messages: updatedMessages,
                      stream: true,
                    });
                    for await (const part2 of finalResponse) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(part2)}\n\n`));
                    }
                  }
                }
                // Mark the end of the stream.
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
      // First call: get the non-streaming response.
      const response = await openai.chat.completions.create({
        ...requestOptions,
        stream: false,
      });
      // If a function call was made…
      if (response.choices && response.choices[0]?.finish_reason === 'function_call') {
        const fc = response.choices[0].function_call;
        if (fc?.name === "order_sandwich" && fc.arguments) {
          let parsedArgs;
          try {
            parsedArgs = JSON.parse(fc.arguments);
          } catch (err) {
            console.error("Failed to parse function call arguments:", err);
          }
          if (parsedArgs && parsedArgs.filling) {
            // Execute the function and capture its result.
            const functionResult = order_sandwich(parsedArgs.filling);
            // Append the function result message.
            const updatedMessages = [
              ...fullMessages,
              {
                role: "function",
                name: "order_sandwich",
                content: functionResult,
              },
            ];
            // Second call: get the final answer using the updated conversation.
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
      }
      // If no function call, return the original response.
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

