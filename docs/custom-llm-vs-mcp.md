# Custom LLM vs MCP: Pros, Cons & Trade-offs

> Comparison of the two approaches for extending Agora Conversational AI agents with external logic and tools.

---

## What Are They?

| | Custom LLM | MCP (Model Context Protocol) |
|---|-----------|------------------------------|
| **What you build** | An HTTP server implementing the OpenAI Chat Completions API (`/chat/completions`) | One or more MCP tool servers exposing tools, resources, and prompts |
| **How Agora connects** | ConvoAI Engine sends all LLM requests to your server instead of directly to a provider | ConvoAI Engine calls LLM provider directly; routes tool calls to your MCP servers |
| **What you control** | Everything: prompting, tool execution, streaming, conversation state, response processing | Tool definitions and tool execution logic only |
| **Standard** | OpenAI Chat Completions API (de facto) | Model Context Protocol (Anthropic, adopted by OpenAI/Google/Microsoft) |
| **Agora support** | Available since launch | Added in v2.4 (February 2026) |

---

## Architecture

### Custom LLM Flow

```
User Speech --> Agora STT --> ConvoAI Engine --> YOUR SERVER --> LLM Provider
                                                     |
                                              Tool Execution
                                              History Management
                                              RTM Commands
                                              Business Logic
                                                     |
                                              SSE Response --> TTS --> User
```

### MCP Flow

```
User Speech --> Agora STT --> ConvoAI Engine --> LLM Provider
                                    |
                              MCP Server(s) <-- tool calls
                                    |
                              SSE Response --> TTS --> User
```

---

## Pros & Cons

### Custom LLM

| Pros | Cons |
|------|------|
| Full request/response control — intercept, modify, and augment every message before and after the LLM sees it | High development effort — must build and maintain an OpenAI-compatible HTTP service |
| Conversation history management — persist, trim, and deduplicate messages across sessions with mode-aware windowing | Operational burden — you host, scale, monitor, and debug the server |
| Model fallback chains — retry with sanitized params, remove tools, switch models, degrade gracefully | Tools are not reusable — implementations are tightly coupled to your endpoint code |
| RTM integration — bridge voice/video to text chat, extract commands, push messages to channels | No standard ecosystem — every custom LLM is unique; no community of shared tools |
| Human handoff & SIP — trigger outbound calls, stop the AI agent, transfer context to a human | Latency risk — adds a hop between Agora and the LLM provider |
| Communication mode awareness — detect voice/chat/video, adjust response style, track transitions | Schema maintenance — every tool must be manually defined as an OpenAI function schema |
| Multi-user / group conversations — speaker identification, presence tracking, per-user context | |
| Photo/media sending via RTM with rate limiting | |
| Tool response caching with configurable TTL | |
| Non-streaming mode with multi-pass tool calling | |
| Custom metadata (`interruptable` flag) for TTS control | |
| Full observability — log every message, tool call, chunk, and error | |

### MCP

| Pros | Cons |
|------|------|
| Zero backend code — configure MCP server URLs in the agent REST API; no custom server needed | No request/response interception — cannot modify messages, prompts, or streaming behaviour |
| Industry standard — tools work with Claude, ChatGPT, Gemini, and any MCP-compatible platform | No conversation history control — managed by Agora's engine with its defaults |
| Huge ecosystem — thousands of community servers (GitHub, Slack, Google Drive, databases, CRMs) | No model fallback — rely on engine error handling; no custom retry or model switching |
| Automatic tool discovery — LLM learns tools from servers without manual schema definition | No RTM integration — cannot bridge to text chat, extract commands, or push messages |
| Separation of concerns — different teams can own different MCP servers independently | No human handoff — cannot trigger SIP calls, stop agents, or transfer context |
| Fast iteration — add/remove tools by changing config, no code deployment | No mode awareness — cannot detect or adapt to voice/chat/video modes |
| Multi-server support with per-server tool whitelisting (`allowed_tools`) | No multi-user support — no speaker identification, presence tracking, or group management |
| Built-in tool access control — up to 128 tools per server | No custom metadata — cannot control TTS interruption per chunk |
| | Additional latency — extra hop from engine to MCP server(s) |
| | Transport limitation — only `streamable_http` currently; no local stdio |
| | Security surface — research shows 43% of MCP implementations had injection vulnerabilities |

---

## Feature-by-Feature Comparison (All 56 Features)

**Legend:** **Full** = fully supported | **Partial** = achievable with workarounds | **None** = not possible

### 1. Streaming & Response Delivery

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 1.1 | SSE Streaming | Full | Full | Both use OpenAI-compatible SSE format |
| 1.2 | Stream Options | Full | Full | Engine passes `stream_options` to provider in both cases |
| 1.3 | Non-Streaming Responses | Full | None | MCP flow is always streaming; no complete JSON response option |
| 1.4 | Finish Reason Signals | Full | Full | Engine emits finish reasons in both cases |
| 1.5 | Usage Token Tracking | Full | Full | Engine can include usage stats in both cases |

### 2. Tool / Function Calling

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 2.1 | Tool Definition | Full | Full | Custom LLM: manual JSON Schema. MCP: auto-discovered |
| 2.2 | Tool Execution Loop | Full | Partial | MCP: engine controls the loop; no iteration limits or inter-pass logic |
| 2.3 | Parallel Tool Calls | Full | Full | Both support `parallel_tool_calls` flag |
| 2.4 | Tool Choice Strategy | Full | Full | Both support `tool_choice` parameter |
| 2.5 | Tool Response Caching | Full | None | Requires server-side cache layer; MCP has no caching mechanism |
| 2.6 | Sandboxed Script Execution | Full | Partial | MCP server could sandbox its own scripts; engine doesn't enforce it |

### 3. Skills & Plugin System

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 3.1 | Skill Definition (SKILL.md) | Full | None | Requires custom server-side skill loading |
| 3.2 | Three-State Skill Management | Full | Partial | `allowed_tools` provides on/off, but no lazy-loading "available" state |
| 3.3 | Remote Skill Installation | Full | Partial | MCP servers added via config, but no git/zip install workflow |
| 3.4 | Multi-Endpoint Architecture | Full | None | MCP has one tool surface per agent |

### 4. LLM Provider & Model Management

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 4.1 | Multi-Provider Support | Full | None | MCP uses whichever LLM the engine is configured with |
| 4.2 | Model Mapping / Aliasing | Full | None | No model routing in MCP |
| 4.3 | Model Fallback Chain | Full | None | No custom retry or fallback logic |
| 4.4 | Response Format Specification | Full | Full | Both support `response_format` |

### 5. Memory & Conversation Management

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 5.1 | Conversation History Storage | Full | None | MCP is stateless; no cross-session persistence |
| 5.2 | Smart Conversation Trimming | Full | None | No control over engine's context trimming |
| 5.3 | Mode-Aware Message Preservation | Full | None | Requires stateful tracking of mode transitions |
| 5.4 | Context Field Passthrough | Full | None | No mechanism for passing arbitrary context objects |
| 5.5 | System Message Deduplication | Full | None | Requires server-side message hashing |

### 6. RAG (Retrieval-Augmented Generation)

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 6.1 | RAG Endpoint | Full | Partial | MCP tool could do retrieval, but no dedicated RAG flow |
| 6.2 | RAG Waiting Messages | Full | None | Cannot inject interim "thinking" messages |
| 6.3 | RAG Context Injection | Full | Partial | MCP returns context as tool result, not as system message |

### 7. Multimodal Content

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 7.1 | Image Content in Messages | Full | Full | Engine passes multimodal content in both cases |
| 7.2 | Audio Content in Messages | Full | Full | Engine passes audio content in both cases |
| 7.3 | Audio Response Streaming | Full | None | Requires custom endpoint returning base64 PCM chunks |
| 7.4 | PCM Audio File Processing | Full | None | Requires server-side file reading and chunking |
| 7.5 | Modalities Parameter | Full | Full | Both support `modalities` parameter |
| 7.6 | Photo / Media Sending | Full | None | Requires pushing content via RTM outside LLM response cycle |

### 8. Real-Time Messaging (RTM) Integration

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 8.1 | RTM Chat Bridge | Full | None | Requires persistent connections; impossible with stateless MCP |
| 8.2 | Persistent RTM Connections | Full | None | MCP servers are request/response only |
| 8.3 | RTM Message Handlers | Full | None | Requires per-session state and callback registration |

### 9. Human Handoff & Telephony

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 9.1 | Human Handoff via SIP | Full | Partial | MCP tool could trigger SIP, but cannot stop AI agent or control lifecycle |
| 9.2 | Dynamic Agent ID Lookup | Full | Partial | MCP tool could query API, but cannot act on result to stop/modify agent |
| 9.3 | Conversation Context Packaging | Full | None | Requires access to full conversation history |

### 10. Communication Mode Awareness

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 10.1 | Mode Prefixing | Full | None | Requires intercepting messages to prepend mode tags |
| 10.2 | Mode Transition Detection | Full | None | Requires stateful tracking across requests |
| 10.3 | Mode-Specific Response Guidelines | Full | None | Requires dynamic system prompt injection |

### 11. Multi-User / Group Conversations

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 11.1 | User ID Prefixing | Full | None | Requires message interception to prepend speaker IDs |
| 11.2 | Group Conversation Guidelines | Full | None | Requires dynamic system prompt sections |
| 11.3 | Presence Context | Full | None | No MCP mechanism for passing presence data |

### 12. System Prompt Management

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 12.1 | Auto-Generated System Context | Full | None | Requires server-side assembly before each LLM call |
| 12.2 | Skill Context Injection | Full | Partial | MCP tools are auto-discovered, but no custom prompt injection |
| 12.3 | Configurable Greeting Message | Full | Full | Both configurable via agent start API |

### 13. Caching & Performance

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 13.1 | Redis Response Caching | Full | None | Requires server-side cache between LLM and response |
| 13.2 | Cache Cost Tracking | Full | None | Requires cache hit/miss instrumentation |
| 13.3 | Temperature-Aware Caching | Full | None | Requires inspecting request parameters |
| 13.4 | Memory Pressure Cleanup | Full | None | Requires background maintenance tasks |

### 14. Authentication & Security

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 14.1 | API Token Authentication | Full | Full | Custom LLM validates tokens; MCP uses `headers` config |
| 14.2 | User Management (GUI) | Full | None | Requires custom admin interface |
| 14.3 | Secrets Management | Full | None | Requires custom admin interface |

### 15. Configuration & Deployment

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 15.1 | YAML Configuration | Full | None | MCP uses JSON in agent start API only |
| 15.2 | Per-Endpoint Environment Config | Full | None | MCP has one configuration surface per agent |
| 15.3 | Health Check Endpoint | Full | Full | Both can expose health checks |
| 15.4 | GUI Dashboard | Full | None | Requires custom admin interface |

### 16. Logging & Observability

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 16.1 | Configurable Log Levels | Full | Full | Both server types can implement logging |
| 16.2 | Component-Scoped Loggers | Full | Full | Both can create named loggers |
| 16.3 | Real-Time Log Viewer | Full | None | Requires custom admin interface with ring buffer |
| 16.4 | Streaming Chunk Logging | Full | None | Cannot observe chunks flowing through the engine |

### 17. Error Handling & Resilience

| # | Feature | Custom LLM | MCP | Notes |
|---|---------|:----------:|:---:|-------|
| 17.1 | Request Validation | Full | Full | Both can validate inputs |
| 17.2 | Graceful Degradation | Full | Partial | MCP failures logged by engine, but no custom fallback |
| 17.3 | Async Cancellation Handling | Full | Full | Engine handles disconnection in both cases |
| 17.4 | Streaming Error Recovery | Full | Full | Both can send error events during streaming |

---

## Summary Scorecard

| | Custom LLM | MCP |
|---|:---------:|:---:|
| **Full** | 56 | 22 |
| **Partial** | 0 | 10 |
| **None** | 0 | 24 |

### What MCP Cannot Do (24 features)

These fall into six categories:

| Category | Features |
|----------|----------|
| **Stateful conversation management** | History storage, smart trimming, deduplication, mode-aware preservation, memory cleanup |
| **Message interception** | Mode prefixing, user ID prefixing, auto-generated system context, mode-specific guidelines, group guidelines, presence context |
| **Persistent connections** | RTM chat bridge, persistent RTM connections, RTM message handlers |
| **Agent lifecycle control** | Conversation context packaging |
| **Server-side infrastructure** | Redis caching, cache cost tracking, temperature-aware caching, user management, secrets management, YAML config, per-endpoint config, GUI dashboard, real-time log viewer |
| **Custom response processing** | Non-streaming mode, audio response streaming, PCM audio processing, photo/media sending, streaming chunk logging |

---

## When to Use Which

### Use MCP When

- You need **standard tool integrations** (weather, calendar, database, CRM) without custom server code
- Your tools are **stateless** and don't need conversation context
- You want to **reuse community MCP servers** or share tools across platforms
- You're **prototyping quickly** and don't need custom response processing
- Your use case is **single-user, single-mode** (e.g., voice-only assistant with simple tools)

### Use Custom LLM When

- You need **conversation history management** across sessions
- You need **RTM integration** (text chat alongside voice/video)
- You need **human handoff** or SIP telephony integration
- You need **multi-user / group conversation** support
- You need **communication mode awareness** (voice vs. chat vs. video)
- You need **model fallback chains** or custom error recovery
- You need to **post-process LLM output** (command extraction, filtering, metadata injection)
- You need **custom caching** or performance optimizations

### Use Both Together

MCP and Custom LLM are **not mutually exclusive**. A Custom LLM server can:

- Act as an MCP client itself, calling MCP servers for standard tool integrations
- Handle all custom business logic (RTM, handoff, history, mode awareness) while delegating tool execution to MCP servers
- Use MCP for community tools and custom code for proprietary integrations

---

## Quick Decision Table

| Dimension | Custom LLM | MCP |
|-----------|:----------:|:---:|
| **Control** | Total | Tool definitions only |
| **Development cost** | High | Near-zero |
| **Maintenance** | You own it | MCP server owners own it |
| **Tool ecosystem** | Build your own | Thousands available |
| **Conversation state** | Full control | Engine defaults |
| **Integrations** | Unlimited (RTM, SIP, etc.) | Tool calls only |
| **Portability** | Agora-specific | Cross-platform |
| **Best for** | Complex, stateful, multi-modal agents | Simple, tool-augmented assistants |

> **Bottom line:** For a voice assistant that checks weather and looks up orders, MCP is faster to ship. For a production system with group calls, human handoff, cross-session memory, and RTM chat — Custom LLM is the only viable path. The most powerful architecture combines both.
