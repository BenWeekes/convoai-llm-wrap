# Custom LLM Feature Catalogue

> A complete inventory of every feature across three Agora Conversational AI custom LLM implementations.

## Implementations

| Short Name | Repo | Stack | Description |
|------------|------|-------|-------------|
| **Impl 1** | `convoai-llm-wrap` | TypeScript / Next.js | Production middleware wrapper |
| **Impl 2** | `agora-conversational-ai-custom-llm-skills` | TypeScript / Express | Skills-based platform |
| **Impl 3** | `Conversational-AI-Server-Sample` | Python, Node.js, Go | Reference samples |

---

## 1. Streaming & Response Delivery

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 1.1 | **HTTP Streaming** | Streams LLM responses over HTTP (`streamable_http`) in OpenAI-compatible `ChatCompletionChunk` format with `data: [DONE]` terminator. | Y | Y | Y |
| 1.2 | **Stream Options** | Supports `stream_options` parameter (e.g., `include_usage`) to control what metadata is included in streamed chunks. | | Y | Y |
| 1.3 | **Non-Streaming Responses** | Returns complete JSON responses without streaming for clients that don't support `streamable_http`. Includes multi-pass tool calling in non-streaming mode. | Y | | |
| 1.4 | **Finish Reason Signals** | Emits typed finish reasons (`stop`, `tool_calls`, `length`, `content_filter`) so the platform knows why generation ended. | Y | Y | Y |
| 1.5 | **Usage Token Tracking** | Reports prompt and completion token counts in the streaming response for cost monitoring. | | Y | Y |

## 2. Tool / Function Calling

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 2.1 | **Tool Definition** | Accepts tool definitions with JSON Schema parameters, passed to the LLM so it can invoke functions. | Y | Y | Y |
| 2.2 | **Tool Execution Loop** | Automatically executes tool calls returned by the LLM and feeds results back, looping until the LLM produces a final text response (with iteration limits to prevent infinite loops). | Y | Y | |
| 2.3 | **Parallel Tool Calls** | Supports executing multiple tool calls concurrently in a single LLM turn via `parallel_tool_calls` flag. | | | Y |
| 2.4 | **Tool Choice Strategy** | Supports `tool_choice` parameter (`auto`, `none`, `required`, or a specific function) to control when the LLM uses tools. | | Y | Y |
| 2.5 | **Tool Response Caching** | Caches tool execution results (with configurable TTL) to avoid redundant calls for repeated queries. | Y | | |
| 2.6 | **Sandboxed Script Execution** | Executes tool scripts (Python, Node.js, Bash) inside Docker containers with memory/CPU limits, network isolation, and timeout enforcement. | | Y | |

## 3. Skills & Plugin System

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 3.1 | **Skill Definition (SKILL.md)** | Skills defined as Markdown files with YAML front matter specifying name, description, scripts, parameters, and runtime requirements. | | Y | |
| 3.2 | **Three-State Skill Management** | Skills can be active (always loaded), available (LLM can activate on demand), or disabled (hidden). Reduces token usage by lazy-loading instructions. | | Y | |
| 3.3 | **Remote Skill Installation** | Install skills from Git repositories, HTTP URLs, or ZIP file uploads. | | Y | |
| 3.4 | **Multi-Endpoint Architecture** | Multiple named endpoints (e.g., support, groupcall, dripshop) each with their own system prompt, tools, and behaviour configuration. | Y | | |

## 4. LLM Provider & Model Management

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 4.1 | **Multi-Provider Support** | Routes requests to different LLM providers (OpenAI, Anthropic, Groq, Azure, Ollama, or any OpenAI-compatible API) based on model name. | | Y | |
| 4.2 | **Model Mapping / Aliasing** | Maps model name aliases to specific providers, allowing flexible model routing without client changes. | | Y | |
| 4.3 | **Model Fallback Chain** | On failure, retries with sanitized parameters, removes tools, switches to a fallback model, then uses minimal parameters before giving up. | Y | | |
| 4.4 | **Response Format Specification** | Supports `response_format` parameter for structured outputs (e.g., JSON mode, JSON Schema) to constrain LLM output format. | | Y | Y |

## 5. Memory & Conversation Management

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 5.1 | **Conversation History Storage** | Persists conversation history per channel/session, keyed by appId:userId:channel, with automatic cleanup of old conversations. | Y | | |
| 5.2 | **Smart Conversation Trimming** | Trims conversation history with tiered message limits, preserving important messages (system, recent, mode transitions) while discarding older ones. | Y | | |
| 5.3 | **Mode-Aware Message Preservation** | Applies different message window sizes for chat vs. voice/video modes, and detects mode transitions in conversation history. | Y | | |
| 5.4 | **Context Field Passthrough** | Accepts a `context` object in the request for passing arbitrary context (e.g., presence data, session metadata) that can be used to augment messages. | Y | | Y |
| 5.5 | **System Message Deduplication** | Hashes system messages to avoid storing duplicates when the same system prompt appears across turns. | Y | | |

## 6. RAG (Retrieval-Augmented Generation)

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 6.1 | **RAG Endpoint** | Dedicated `/rag/chat/completions` endpoint that retrieves relevant knowledge before calling the LLM. | | | Y |
| 6.2 | **RAG Waiting Messages** | Sends a brief "thinking" message (e.g., "Just a moment...") while performing retrieval, so the user isn't left in silence. | | | Y |
| 6.3 | **RAG Context Injection** | Prepends retrieved knowledge as a system message to augment the LLM's context before generation. | Y | | Y |

## 7. Multimodal Content

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 7.1 | **Image Content in Messages** | Supports `image_url` content blocks in user messages so the LLM can process images (vision). | | | Y |
| 7.2 | **Audio Content in Messages** | Supports `input_audio` content blocks in user messages for audio-capable models. | | | Y |
| 7.3 | **Audio Response Streaming** | Dedicated `/audio/chat/completions` endpoint that returns audio responses as base64-encoded PCM chunks streamed over HTTP. | | | Y |
| 7.4 | **PCM Audio File Processing** | Reads PCM audio files, chunks them by sample rate and duration, base64-encodes each chunk, and streams them to the client. | | | Y |
| 7.5 | **Modalities Parameter** | Supports `modalities` parameter (e.g., `["text"]`, `["text", "audio"]`) to specify which output types the LLM should produce. | | | Y |
| 7.6 | **Photo / Media Sending** | Sends photos or media to users via RTM with per-user rate limiting (e.g., 30-second cooldown). | Y | | |

## 8. Real-Time Messaging (RTM) Integration

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 8.1 | **RTM Chat Bridge** | Bridges voice/video calls to text chat via Agora RTM, allowing the agent to respond to text messages in the same channel. | Y | | |
| 8.2 | **Persistent RTM Connections** | Maintains long-lived RTM connections with exponential backoff reconnection (up to 10 attempts, 1.5x multiplier, 60s max). | Y | | |
| 8.3 | **RTM Message Handlers** | Registers per-session message handlers so different endpoints can process RTM messages with their own logic. | Y | | |

## 9. Human Handoff & Telephony

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 9.1 | **Human Handoff via SIP** | Triggers a SIP outbound call to connect a human agent, stops the AI agent, and transfers the conversation with context. | Y | | |
| 9.2 | **Dynamic Agent ID Lookup** | Queries the ConvoAI API to find the active agent's ID for a given channel before performing handoff operations. | Y | | |
| 9.3 | **Conversation Context Packaging** | Packages the full conversation history into a summary that can be handed off to a human agent. | Y | | |

## 10. Communication Mode Awareness

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 10.1 | **Mode Prefixing** | Prepends `[CHAT]`, `[VOICE CALL]`, or `[VIDEO CALL]` to messages so the LLM knows the communication channel and can adapt its response style. | Y | | |
| 10.2 | **Mode Transition Detection** | Detects when a conversation switches between chat, voice, and video modes, and adjusts context accordingly. | Y | | |
| 10.3 | **Mode-Specific Response Guidelines** | Injects system prompt instructions that guide the LLM to produce shorter responses for voice, richer responses for chat, etc. | Y | | |

## 11. Multi-User / Group Conversations

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 11.1 | **User ID Prefixing** | Prepends `[userId]` to each message so the LLM can identify and address individual speakers in a group conversation. | Y | | |
| 11.2 | **Group Conversation Guidelines** | Injects system prompt instructions for facilitating multi-user discussions, including speaker identification and turn management. | Y | | |
| 11.3 | **Presence Context** | Passes presence data (which users are active/idle) to the LLM for awareness of who is in the conversation. | Y | | |

## 12. System Prompt Management

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 12.1 | **Auto-Generated System Context** | Automatically builds system message sections for user ID handling, communication mode, available modes, and group conversation rules. | Y | | |
| 12.2 | **Skill Context Injection** | Injects available skill summaries and activated skill instructions into the system message so the LLM knows its capabilities. | | Y | |
| 12.3 | **Configurable Greeting Message** | Sets the agent's initial greeting message via environment variable, spoken/sent when a conversation starts. | Y | | |

## 13. Caching & Performance

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 13.1 | **Redis Response Caching** | Caches LLM responses in Redis with configurable TTL, smart cache key generation, and context-dependent message detection to avoid caching ambiguous queries. | | Y | |
| 13.2 | **Cache Cost Tracking** | Tracks tokens saved by cache hits and estimates dollar savings for monitoring cache ROI. | | Y | |
| 13.3 | **Temperature-Aware Caching** | Only caches responses when temperature is at or below a threshold (e.g., 0.1) to ensure deterministic results are cached. | | Y | |
| 13.4 | **Memory Pressure Cleanup** | Detects memory pressure in conversation storage and proactively cleans up old/large conversations. | Y | | |

## 14. Authentication & Security

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 14.1 | **API Token Authentication** | Validates Bearer tokens on incoming requests. Can be optional (skipped if no key configured) or required. | Y | Y | |
| 14.2 | **User Management (GUI)** | Admin dashboard with user creation, role-based access (admin/user), JWT sessions, and API key management. | | Y | |
| 14.3 | **Secrets Management** | GUI for viewing/editing environment variables (API keys, etc.) with automatic backup. | | Y | |

## 15. Configuration & Deployment

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 15.1 | **YAML Configuration** | Centralized YAML config with environment variable interpolation (`${VAR}` syntax) and Zod schema validation. | | Y | |
| 15.2 | **Per-Endpoint Environment Config** | Each endpoint has its own set of environment variables for RTM, LLM provider, model, system prompt, etc. | Y | | |
| 15.3 | **Health Check Endpoint** | `/ping` or `/health` endpoint for load balancer and monitoring liveness checks. | | Y | Y |
| 15.4 | **GUI Dashboard** | Web-based admin dashboard for skills, cache, logs, config editing, playground testing, and user management. | | Y | |

## 16. Logging & Observability

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 16.1 | **Configurable Log Levels** | Supports multiple log levels (TRACE, DEBUG, INFO, WARN, ERROR) controlled via environment variable. | Y | Y | Y |
| 16.2 | **Component-Scoped Loggers** | Creates named child loggers per component (RTM, endpoint, conversation, cache, tool, LLM) for targeted debugging. | Y | Y | |
| 16.3 | **Real-Time Log Viewer** | GUI-based log viewer with level filtering, text search, copy-to-clipboard, and save-to-file. Backed by an in-memory ring buffer. | | Y | |
| 16.4 | **Streaming Chunk Logging** | Logs individual streaming chunks with type classification (content, tool call, finish, error) for debugging response generation. | Y | Y | |

## 17. Error Handling & Resilience

| # | Feature | Description | Impl 1 | Impl 2 | Impl 3 |
|---|---------|-------------|:------:|:------:|:------:|
| 17.1 | **Request Validation** | Validates incoming request bodies (required fields, types, ranges) using Pydantic, Zod, or framework-native binding. | Y | Y | Y |
| 17.2 | **Graceful Degradation** | Failures in optional subsystems (cache, sandbox, RTM) are logged but don't block the main request pipeline. | Y | Y | |
| 17.3 | **Async Cancellation Handling** | Detects client disconnection mid-stream and cleanly aborts processing (HTTP 499). | | | Y |
| 17.4 | **Streaming Error Recovery** | Catches errors during HTTP streaming and sends error events rather than dropping the connection silently. | Y | Y | Y |

---

## Summary

**Total unique features catalogued: 56**

| Category | Count |
|----------|------:|
| Streaming & Response Delivery | 5 |
| Tool / Function Calling | 6 |
| Skills & Plugin System | 4 |
| LLM Provider & Model Management | 4 |
| Memory & Conversation Management | 5 |
| RAG | 3 |
| Multimodal Content | 6 |
| RTM Integration | 3 |
| Human Handoff & Telephony | 3 |
| Communication Mode Awareness | 3 |
| Multi-User / Group Conversations | 3 |
| System Prompt Management | 3 |
| Caching & Performance | 4 |
| Authentication & Security | 3 |
| Configuration & Deployment | 4 |
| Logging & Observability | 4 |
| Error Handling & Resilience | 4 |

### Coverage by Implementation

| Implementation | Features | Focus Area |
|----------------|:--------:|------------|
| **Impl 1** — `convoai-llm-wrap` | 32 | Conversation management, RTM, mode awareness, human handoff |
| **Impl 2** — `agora-conversational-ai-custom-llm-skills` | 24 | Skills/plugins, multi-provider, caching, admin GUI |
| **Impl 3** — `Conversational-AI-Server-Sample` | 19 | Multimodal, RAG, reference patterns |
