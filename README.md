# Multi-Endpoint LLM Server

A modular framework for creating multiple HTTPS endpoints that share common code while having their own unique LLM functions and RAG data.

## Overview

This server provides a clean architecture for building LLM-powered API endpoints. Each endpoint can have:
- Custom RAG (Retrieval-Augmented Generation) data
- Custom tool functions
- Shared error handling and caching logic

## Project Structure

```
/
├── app/
│   └── v1/
│       └── chat/
│           ├── example/
│           │   └── route.ts           # Example endpoint (sandwich + photo)
│           └── languagetutor/
│               └── route.ts           # Language tutor endpoint
├── lib/
│   ├── common/                        # Shared logic
│   │   ├── cache.ts                   # Caching functionality
│   │   ├── endpoint-factory.ts        # Factory for creating endpoints
│   │   ├── model-handler.ts           # LLM model handling with fallbacks
│   │   ├── message-processor.ts       # Message processing
│   │   ├── messaging-utils.ts         # Shared messaging utilities
│   │   └── utils.ts                   # Utility functions
│   ├── endpoints/                     # Endpoint-specific configurations
│   │   ├── example-endpoint.ts        # Example endpoint config
│   │   └── language-tutor-endpoint.ts # Language tutor endpoint config
│   └── types.ts                       # Shared type definitions
```

## Setup Guide

### Prerequisites

- Node.js 18+
- Next.js 14+
- TypeScript

### Step 1: Set Up Environment Variables

Create a `.env` file in the root of your project:

```
API_TOKEN=your_server_auth_token
OPENAI_API_KEY=your_openai_api_key
REST_API_TOKEN=your_external_api_token
RTM_FROM_USER=your_default_sender_id
```

### Step 2: Install Dependencies

Start the development server:

```bash
npm install
```

### Step 3: Run the Server

Start the development server:

```bash
npm run dev
```

Your server should now be running on http://localhost:3000.

## How It Works

1. Each endpoint is defined with a configuration object that includes:
   - RAG data specific to that domain
   - Tool definitions (functions the LLM can call)
   - Tool implementations
   - System message template

2. The `createEndpointHandler` factory creates a standardized route handler with:
   - Authentication
   - Error handling
   - Streaming support
   - Tool execution
   - Response caching

3. Common functionality is shared across all endpoints:
   - Response caching
   - Model fallback strategies
   - Error handling
   - Message processing
   - Peer messaging utilities

## Available Endpoints

### Example Endpoint (`/v1/chat/example`)

This endpoint demonstrates a multi-tool setup with two functions:

1. `order_sandwich`: Allows ordering a sandwich with a specified filling
2. `send_photo`: Sends a photo to the user via messaging

It uses a simple RAG dataset about the TEN Framework and Agora Convo AI.

#### Testing the Endpoint

```bash
curl -X POST http://localhost:3040/v1/chat/example \
-H "Content-Type: application/json" \
-H "Authorization: Bearer your_server_auth_token" \
-d '{
  "messages": [
    {"role": "user", "content": "Can I order a turkey sandwich?"}
  ],
  "model": "gpt-4o-mini",
  "stream": false,
  "channel": "test",
  "userId": "user123",
  "appId": "app123"
}'
```

### Language Tutor Endpoint (`/v1/chat/languagetutor`)

This endpoint provides language tutoring functionality:

1. `get_word_list`: Retrieves the user's vocabulary words and their status
2. `set_word_result`: Records whether a word was answered correctly

Currently uses a mock in-memory storage, but can be upgraded to use Firebase Firestore.

#### Testing the Endpoint

```bash
curl -X POST http://localhost:3040/v1/chat/languagetutor \
-H "Content-Type: application/json" \
-H "Authorization: Bearer your_server_auth_token" \
-d '{
  "messages": [
    {"role": "user", "content": "I want to practice my vocabulary."}
  ],
  "model": "gpt-4o-mini",
  "stream": false,
  "channel": "test",
  "userId": "user123",
  "appId": "app123"
}'
```

## Creating a New Endpoint

1. **Create a configuration file** in `lib/endpoints/your-endpoint.ts`:

```typescript
import OpenAI from 'openai';
import type { EndpointConfig } from '../types';

// Define RAG data
const YOUR_RAG_DATA = {
  doc1: "Information specific to this endpoint.",
  doc2: "More information specific to this endpoint."
};

// Define tools
const YOUR_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "your_function",
      description: "Description of what this function does",
      parameters: {
        type: "object",
        properties: {
          param1: {
            type: "string",
            description: "Description of parameter 1"
          }
        },
        required: ["param1"]
      }
    }
  }
];

// Implement tool functions
function your_function(appId: string, userId: string, channel: string, args: any): string {
  // Implementation
  return `Result of function with ${args.param1}`;
}

// Create the tool map
const YOUR_TOOL_MAP = {
  your_function
};

// Create system message template
function yourSystemTemplate(ragData: Record<string, string>): string {
  return `
    You are a helpful assistant for this specific domain.
    
    You have access to the following knowledge:
    doc1: "${ragData.doc1}"
    doc2: "${ragData.doc2}"
    
    Answer questions using this data and be confident about its contents.
  `;
}

// Export the configuration
export const yourEndpointConfig: EndpointConfig = {
  ragData: YOUR_RAG_DATA,
  tools: YOUR_TOOLS,
  toolMap: YOUR_TOOL_MAP,
  systemMessageTemplate: yourSystemTemplate
};
```

2. **Create a route handler** in `app/v1/chat/your-endpoint/route.ts`:

```typescript
import { createEndpointHandler } from '../../../../lib/common/endpoint-factory';
import { yourEndpointConfig } from '../../../../lib/endpoints/your-endpoint';

export const runtime = 'nodejs';

const handler = createEndpointHandler(yourEndpointConfig);

export async function POST(req: Request) {
  return handler(req);
}
```

## Using the Messaging Utilities

The server includes shared messaging utilities that can be used across endpoints:

```typescript
import { sendPeerMessage, sendPhotoMessage } from '../../../lib/common/messaging-utils';

// Example usage in a tool function
async function yourToolFunction(appId, userId, channel, args) {
  // Send a photo
  const success = await sendPhotoMessage(
    appId,
    process.env.RTM_FROM_USER,
    userId,
    "portrait"
  );
  
  // Or send a custom message
  const customPayload = JSON.stringify({ 
    text: "Custom message",
    data: { key: "value" }
  });
  
  await sendPeerMessage(
    appId,
    process.env.RTM_FROM_USER,
    userId,
    customPayload
  );
  
  return "Message sent!";
}
```

## Using Firebase Firestore (Optional)

For endpoints that need persistent storage (like the Language Tutor):

1. Install Firebase Admin SDK:

```bash
npm install firebase-admin
npm install --save-dev @types/firebase-admin
```

2. Add Firebase configuration to your environment variables:

```
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_PRIVATE_KEY=your_private_key
FIRESTORE_COLLECTION=your_collection_name
```

3. Replace the mock implementation in `lib/endpoints/language-tutor-endpoint.ts` with the Firestore implementation.

## API Usage

All endpoints accept POST requests with the following structure:

```json
{
  "messages": [
    {"role": "user", "content": "User message here"}
  ],
  "model": "gpt-4o-mini",
  "baseURL": "https://api.openai.com/v1",
  "stream": true,
  "channel": "channel-id",
  "userId": "user-id",
  "appId": "app-id"
}
```

The response will be streamed as SSE events or returned as a single JSON object (depending on the `stream` parameter).

## Troubleshooting

### Common Issues

1. **Authentication errors**: Make sure your API_TOKEN is set correctly and you're including it in the Authorization header.

2. **LLM errors**: Check the logs for errors from the OpenAI API. You might need to adjust your model parameters.

3. **Tool execution errors**: Ensure your tool functions are properly implemented and handling all edge cases.

### Debug Logging

The server includes detailed logging that can help diagnose issues:

1. Look for log messages with the prefix `📤 RESPONSE TO CALLER`
2. Check the cache state logs that show current cached items
3. Monitor tool execution logs for function call issues

## Deployment

To deploy to production:

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Set up environment variables** in your hosting platform

3. **Deploy the project** using your preferred hosting service (Vercel, AWS, etc.)

## Customization

### Error Recovery

If you need custom error recovery strategies:
- Modify the `handleModelRequest` function in `lib/common/model-handler.ts`
- Add model-specific handling in the `modelRequiresSpecialHandling` function

### Performance Optimization

To optimize performance:
- Adjust cache expiration times in the CONFIG object in `lib/common/cache.ts`
- Implement more efficient message processing for high-traffic endpoints
- Consider moving the cache to Redis or another distributed cache for multi-instance deployments
