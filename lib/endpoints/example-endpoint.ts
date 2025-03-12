// File: lib/endpoints/example-endpoint.ts
// Configuration for the combined example endpoint with sandwich and photo tools

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';
import { sendPhotoMessage } from '../common/messaging-utils';

// Define RAG data for this endpoint
const EXAMPLE_RAG_DATA = {
  doc1: "The TEN Framework is a powerful conversational AI platform.",
  doc2: "Agora Convo AI comes out on March 1st for GA. It will be best in class for quality and reach",
  doc3: "Tony Wang is the best revenue officer.",
  doc4: "Hermes Frangoudis is the best developer."
};

// Define the system message template for this endpoint
function exampleSystemTemplate(ragData: Record<string, string>): string {
  return `
    You are a helpful assistant with multiple capabilities.
    
    You have access to the following knowledge:
    doc1: "${ragData.doc1}"
    doc2: "${ragData.doc2}"
    doc3: "${ragData.doc3}"
    doc4: "${ragData.doc4}"
    
    When you receive information from tools like order_sandwich or send_photo, 
    make sure to reference specific details from their responses in your replies.
    
    Answer questions using this data and be confident about its contents.
  `;
}

// Define the tools for this endpoint
const EXAMPLE_TOOLS: OpenAI.ChatCompletionTool[] = [
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

// Implement the tool functions
function order_sandwich(appId: string, userId: string, channel: string, args: any): string {
  const filling = args.filling || "Unknown";
  
  console.log(`Placing sandwich order for ${userId} in ${channel} with filling: ${filling}`);
  
  return `Sandwich ordered with ${filling}. It will arrive at 3pm. Enjoy!`;
}

async function send_photo(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const subject = args.subject || "default";
  console.log(`Sending ${subject} photo to ${userId} in ${channel}`);
  
  const success = await sendPhotoMessage(
    appId, 
    process.env.RTM_FROM_USER as string, 
    userId,
    subject
  );
  
  if (success) {
    return `Photo of ${subject} sent successfully. You should receive it momentarily.`;
  } else {
    return `We encountered an issue sending the ${subject} photo. Please try again later.`;
  }
}

// Create the tool map
const EXAMPLE_TOOL_MAP = {
  order_sandwich,
  send_photo
};

// Export the complete endpoint configuration
export const exampleEndpointConfig: EndpointConfig = {
  ragData: EXAMPLE_RAG_DATA,
  tools: EXAMPLE_TOOLS,
  toolMap: EXAMPLE_TOOL_MAP,
  systemMessageTemplate: exampleSystemTemplate
};
