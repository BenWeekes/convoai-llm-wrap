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
                                              HTTP Response --> TTS --> User
```

### MCP Flow

```
User Speech --> Agora STT --> ConvoAI Engine --> LLM Provider
                                    |
                              MCP Server(s) <-- tool calls
                                    |
                              HTTP Response --> TTS --> User
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
| | Transport limitation — only `streamable_http` currently; no local stdio servers |
| | Security surface — research shows 43% of MCP implementations had injection vulnerabilities |

---

## Complete Feature Comparison Table

All 56 features from the [Feature Catalogue](feature-catalogue.md), rated for each approach.

| # | Feature | Custom LLM | MCP |
|---|---------|:----------:|:---:|
| | **Streaming & Response Delivery** | | |
| 1.1 | HTTP Streaming (`streamable_http`) | Y | Y |
| 1.2 | Stream Options (`include_usage`, etc.) | Y | Y |
| 1.3 | Non-Streaming Responses | Y | - |
| 1.4 | Finish Reason Signals | Y | Y |
| 1.5 | Usage Token Tracking | Y | Y |
| | **Tool / Function Calling** | | |
| 2.1 | Tool Definition (JSON Schema) | Y | Y |
| 2.2 | Tool Execution Loop (multi-pass) | Y | ~ |
| 2.3 | Parallel Tool Calls | Y | Y |
| 2.4 | Tool Choice Strategy | Y | Y |
| 2.5 | Tool Response Caching | Y | - |
| 2.6 | Sandboxed Script Execution | Y | ~ |
| | **Skills & Plugin System** | | |
| 3.1 | Skill Definition (SKILL.md) | Y | - |
| 3.2 | Three-State Skill Management | Y | ~ |
| 3.3 | Remote Skill Installation | Y | ~ |
| 3.4 | Multi-Endpoint Architecture | Y | - |
| | **LLM Provider & Model Management** | | |
| 4.1 | Multi-Provider Support | Y | - |
| 4.2 | Model Mapping / Aliasing | Y | - |
| 4.3 | Model Fallback Chain | Y | - |
| 4.4 | Response Format Specification | Y | Y |
| | **Memory & Conversation Management** | | |
| 5.1 | Conversation History Storage | Y | - |
| 5.2 | Smart Conversation Trimming | Y | - |
| 5.3 | Mode-Aware Message Preservation | Y | - |
| 5.4 | Context Field Passthrough | Y | - |
| 5.5 | System Message Deduplication | Y | - |
| | **RAG (Retrieval-Augmented Generation)** | | |
| 6.1 | RAG Endpoint | Y | ~ |
| 6.2 | RAG Waiting Messages | Y | - |
| 6.3 | RAG Context Injection | Y | ~ |
| | **Multimodal Content** | | |
| 7.1 | Image Content in Messages | Y | Y |
| 7.2 | Audio Content in Messages | Y | Y |
| 7.3 | Audio Response Streaming | Y | - |
| 7.4 | PCM Audio File Processing | Y | - |
| 7.5 | Modalities Parameter | Y | Y |
| 7.6 | Photo / Media Sending (via RTM) | Y | - |
| | **Real-Time Messaging (RTM) Integration** | | |
| 8.1 | RTM Chat Bridge | Y | - |
| 8.2 | Persistent RTM Connections | Y | - |
| 8.3 | RTM Message Handlers | Y | - |
| | **Human Handoff & Telephony** | | |
| 9.1 | Human Handoff via SIP | Y | ~ |
| 9.2 | Dynamic Agent ID Lookup | Y | ~ |
| 9.3 | Conversation Context Packaging | Y | - |
| | **Communication Mode Awareness** | | |
| 10.1 | Mode Prefixing ([CHAT], [VOICE], [VIDEO]) | Y | - |
| 10.2 | Mode Transition Detection | Y | - |
| 10.3 | Mode-Specific Response Guidelines | Y | - |
| | **Multi-User / Group Conversations** | | |
| 11.1 | User ID Prefixing | Y | - |
| 11.2 | Group Conversation Guidelines | Y | - |
| 11.3 | Presence Context | Y | - |
| | **System Prompt Management** | | |
| 12.1 | Auto-Generated System Context | Y | - |
| 12.2 | Skill Context Injection | Y | ~ |
| 12.3 | Configurable Greeting Message | Y | Y |
| | **Caching & Performance** | | |
| 13.1 | Redis Response Caching | Y | - |
| 13.2 | Cache Cost Tracking | Y | - |
| 13.3 | Temperature-Aware Caching | Y | - |
| 13.4 | Memory Pressure Cleanup | Y | - |
| | **Authentication & Security** | | |
| 14.1 | API Token Authentication | Y | Y |
| 14.2 | User Management (GUI) | Y | - |
| 14.3 | Secrets Management | Y | - |
| | **Configuration & Deployment** | | |
| 15.1 | YAML Configuration | Y | - |
| 15.2 | Per-Endpoint Environment Config | Y | - |
| 15.3 | Health Check Endpoint | Y | Y |
| 15.4 | GUI Dashboard | Y | - |
| | **Logging & Observability** | | |
| 16.1 | Configurable Log Levels | Y | Y |
| 16.2 | Component-Scoped Loggers | Y | Y |
| 16.3 | Real-Time Log Viewer | Y | - |
| 16.4 | Streaming Chunk Logging | Y | - |
| | **Error Handling & Resilience** | | |
| 17.1 | Request Validation | Y | Y |
| 17.2 | Graceful Degradation | Y | ~ |
| 17.3 | Async Cancellation Handling | Y | Y |
| 17.4 | Streaming Error Recovery | Y | Y |

**Key:** **Y** = Supported | **~** = Partial (workarounds needed) | **-** = Not supported

### Totals

| | Custom LLM | MCP |
|---|:---------:|:---:|
| **Supported (Y)** | 56 | 22 |
| **Partial (~)** | 0 | 10 |
| **Not supported (-)** | 0 | 24 |

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
