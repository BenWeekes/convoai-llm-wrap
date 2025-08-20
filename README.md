# LLM Wrapper Server

A middleware server that enhances LLM interactions for platforms with basic LLM support, adding advanced features like tool execution, multi-modal communication, conversation persistence, and group interaction capabilities.

## Purpose

This server acts as an intelligent wrapper between Agora's ConvoAI Platform which provides support for basic LLM interactions and the actual LLM providers (OpenAI, Groq, etc.), adding:
- Custom tool/function execution
- RTM (Real-Time Messaging) chat integration
- Multi-user group conversation support
- Voice/video/chat mode awareness
- Conversation history management
- Response caching and optimization

Perfect for platforms that have LLM integration but need additional features without modifying their core infrastructure.

## Architecture

```
Platform → LLM Wrapper Server → LLM Provider (OpenAI/Groq/etc.)
    ↓            ↓                      ↑
 Request    Enhanced Features      Standard API
            - Tools/Functions
            - RTM Chat
            - Group Support
            - Mode Awareness
            - History Management
```

## Project Structure

```
/
├── app/
│   └── v1/
│       └── chat/
│           ├── example/           # Example endpoint (video + chat)
│           ├── groupcall/         # Group call endpoint (video + chat)
│           ├── dripshop/          # Shopping assistant (API-only)
│           └── languagetutor/     # Language tutor (API-only)
├── lib/
│   ├── common/
│   │   ├── cache.ts              # Tool response caching
│   │   ├── conversation-store.ts # Channel-based conversation history
│   │   ├── endpoint-factory.ts   # Endpoint creation factory
│   │   ├── logger.ts             # Centralized logging system
│   │   ├── message-processor.ts  # Message cleaning and prefixing
│   │   ├── messaging-utils.ts    # Photo/message sending utilities
│   │   ├── model-handler.ts      # LLM interaction with fallbacks
│   │   ├── rtm-chat-handler.ts   # RTM chat mode integration
│   │   ├── rtm-client-manager.ts # Persistent RTM connections
│   │   ├── system-prompt-helpers.ts # Automatic context generation
│   │   └── utils.ts              # Common utilities
│   ├── endpoints/
│   │   ├── example-endpoint.ts
│   │   ├── groupcall-endpoint.ts
│   │   ├── dripshop-endpoint.ts
│   │   └── language-tutor-endpoint.ts
│   └── types.ts
```

## Key Features

### 1. Tool/Function Execution
Extend LLM capabilities with custom functions that can interact with external systems, databases, or APIs.

### 2. Multi-Modal Communication
Support voice calls, video calls, and text chat with automatic mode detection and appropriate response formatting.

### 3. Group Conversation Management
Handle multiple users in the same conversation with automatic speaker identification and context preservation.

### 4. RTM Chat Integration
Seamlessly bridge real-time text messaging with voice/video interactions while maintaining conversation continuity.

### 5. Intelligent Message Processing
Automatically prefix messages with user IDs and communication modes to provide context to the LLM.

### 6. Conversation Persistence
Maintain conversation history across sessions with smart memory management and channel-based isolation.

## Setup

### Environment Variables

```bash
# Core
API_TOKEN=your_wrapper_auth_token
OPENAI_API_KEY=your_openai_api_key
LOG_LEVEL=INFO  # ERROR, WARN, INFO, DEBUG, or TRACE

# External Services
REST_API_TOKEN=your_agora_rest_token

# RTM Configuration (per endpoint that needs chat)
EXAMPLE_RTM_APP_ID=your_app_id
EXAMPLE_RTM_FROM_USER=agent-example
EXAMPLE_RTM_CHANNEL=example-channel
EXAMPLE_RTM_LLM_API_KEY=your_llm_key
EXAMPLE_RTM_LLM_MODEL=gpt-4o-mini
EXAMPLE_RTM_LLM_BASE_URL=https://api.openai.com/v1

# Optional: Firebase for persistent storage
FIRESTORE_PROJECT_ID=your_project_id
FIRESTORE_CLIENT_EMAIL=your_email
FIRESTORE_PRIVATE_KEY=your_private_key
```

### Running the Server

```bash
npm install
npm run dev  # Development
npm run build && npm start  # Production
```

## Endpoint Configuration

Each endpoint wraps LLM interactions with specific enhancements:

```typescript
export interface EndpointConfig {
  ragData: Record<string, string>;         // Domain knowledge injection
  tools: OpenAI.ChatCompletionTool[];      // Available functions
  toolMap: Record<string, ToolFunction>;   // Function implementations
  systemMessageTemplate: (ragData) => string; // System prompt customization
  communicationModes?: {
    supportsChat?: boolean;               // Enable RTM chat bridge
    endpointMode?: 'voice' | 'video';    // Call type for this endpoint
    prependUserId?: boolean;              // Add [userId] to messages
    prependCommunicationMode?: boolean;   // Add [CHAT]/[VIDEO]/[VOICE]
  };
}
```

### Configuration Options

| Option | Purpose | Use When |
|--------|---------|----------|
| `supportsChat` | Enables RTM chat integration | Platform needs text + voice/video |
| `endpointMode` | Sets voice/video mode | Platform has calling features |
| `prependUserId` | Adds speaker identification | Multi-user conversations |
| `prependCommunicationMode` | Adds mode context | LLM needs to know interaction type |

## Pre-Built Endpoints

### Example (`/v1/chat/example`)
**Wraps**: Single-user interactions  
**Adds**: Photo sending, sandwich ordering tools  
**Config**: Chat + Video, Mode awareness

### Group Call (`/v1/chat/groupcall`)
**Wraps**: Multi-user conversations  
**Adds**: Speaker identification, group context  
**Config**: Chat + Video, User ID prefixing

### Dripshop (`/v1/chat/dripshop`)
**Wraps**: Shopping interactions  
**Adds**: Outfit search, trend reports  
**Config**: API-only, User ID prefixing (no chat history)

### Language Tutor (`/v1/chat/languagetutor`)
**Wraps**: Educational interactions  
**Adds**: Word tracking, progress persistence  
**Config**: Stateless, Firebase storage

## API Interface

The wrapper accepts standard LLM requests with additional metadata:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "metadata": {
        "publisher": "Alice",
        "source": "voice"
      }
    }
  ],
  "model": "gpt-4o-mini",
  "stream": true,
  "channel": "room-123",
  "userId": "user-123",
  "appId": "platform-app-id",
  "enable_rtm": true,
  "agent_rtm_channel": "rtm-channel",
  "context": {
    "presence": {
      "Alice": {"state": "active"},
      "Bob": {"state": "idle"}
    }
  }
}
```

**Returns**: Standard OpenAI-compatible responses with tool executions handled transparently.

## Creating Custom Wrappers

1. Define your enhancements in `lib/endpoints/your-wrapper.ts`:

```typescript
import type { EndpointConfig } from '../types';

// Define custom tools for your platform's needs
const YOUR_TOOLS = [
  {
    type: "function",
    function: {
      name: "platform_specific_action",
      description: "Performs platform-specific action",
      parameters: { /* ... */ }
    }
  }
];

// Implement tool logic
const YOUR_TOOL_MAP = {
  platform_specific_action: async (appId, userId, channel, args) => {
    // Integration with your platform's APIs
    return "Action completed";
  }
};

export const yourWrapperConfig: EndpointConfig = {
  ragData: { /* Platform-specific knowledge */ },
  tools: YOUR_TOOLS,
  toolMap: YOUR_TOOL_MAP,
  systemMessageTemplate: (ragData) => `Custom instructions`,
  communicationModes: {
    // Configure based on platform capabilities
    supportsChat: true,
    endpointMode: 'video',
    prependUserId: true,
    prependCommunicationMode: false
  }
};
```

2. Create route in `app/v1/chat/your-wrapper/route.ts`:

```typescript
import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { yourWrapperConfig } from '@/lib/endpoints/your-wrapper';

const handler = createEndpointHandler(yourWrapperConfig, 'YOUR_WRAPPER');
export const GET = handler;
export const POST = handler;
```

## How the Wrapper Works

1. **Request Interception**: Platform sends standard LLM request to wrapper endpoint
2. **Enhancement Injection**: Wrapper adds tools, context, and system prompts
3. **Message Processing**: Applies prefixing and mode detection based on configuration
4. **LLM Communication**: Forwards enhanced request to actual LLM provider
5. **Tool Execution**: Intercepts and executes function calls transparently
6. **Response Processing**: Cleans and formats response for platform compatibility
7. **Return to Platform**: Sends OpenAI-compatible response back

## Advanced Features

### Automatic Fallbacks
If primary LLM fails, automatically retries with:
- Simplified parameters (no tools)
- Alternative models (GPT-3.5 fallback)
- Minimal configuration

### Smart Caching
- Tool responses cached for 24 hours
- Conversation history with automatic trimming
- Channel-based isolation for multi-tenant usage

### Persistent Connections
- RTM clients maintain persistent connections
- Auto-reconnect with exponential backoff
- Connection pooling for efficiency

## Monitoring & Debugging

Control logging detail with `LOG_LEVEL`:
- `ERROR`: Critical failures only
- `WARN`: Warnings and errors
- `INFO`: Request flow (default)
- `DEBUG`: Detailed processing
- `TRACE`: Full message content

Key log prefixes:
- `[ENDPOINT]`: Request handling
- `[RTM]`: Chat integration
- `[TOOL]`: Function execution
- `[LLM]`: Model communication
- `[CONVERSATION]`: History management

## Deployment

The wrapper can be deployed to any Node.js hosting platform:

```bash
npm run build
npm start
```

Configure environment variables in your hosting platform and ensure your platform points to the wrapper endpoints instead of directly to the LLM provider.

## Use Cases

- **Adding tools to ChatGPT**: Platform uses OpenAI but needs custom functions
- **Multi-user support**: Platform has basic LLM but needs group conversations
- **Mode bridging**: Platform has separate chat/voice but needs unified context
- **Enhanced prompting**: Platform needs domain-specific knowledge injection
- **Response caching**: Platform needs to optimize repeated LLM calls
- **Conversation persistence**: Platform needs memory across sessions
