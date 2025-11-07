# Support Endpoint - Implementation Guide

## What Was Built

A new `/v1/chat/support` endpoint with two LLM tools:
1. **`request_human_agent`** - Triggers SIP outbound call to human agent + stops ConvoAI agent
2. **`lookup_order`** - Looks up order information by email (hardcoded for benweekes73@gmail.com)

## Files Created

### 1. `lib/common/handoff-utils.ts`
- `triggerOutboundCall()` - Calls SIP API to connect human via phone
- `stopConvoAIAgent()` - Calls ConvoAI `/leave` API to remove agent
- `packageConversationContext()` - Formats conversation history (optional)

### 2. `lib/common/order-utils.ts`
- `validateEmail()` - Basic email validation
- `lookupOrder()` - Returns hardcoded order for benweekes73@gmail.com

### 3. `lib/endpoints/support-endpoint.ts`
- Tool definitions and implementations
- System prompt for customer support
- Endpoint configuration with communication modes

### 4. `app/v1/chat/support/route.ts`
- Route handler (GET and POST)

### 5. `lib/common/endpoint-factory.ts` (Modified)
- Added support for `sipConfig` and `convoAIConfig` parameters
- Sets request configs for tools to access

### 6. `lib/types.ts` (Modified)
- Added `SipConfig` and `ConvoAIConfig` types
- Updated `EndpointRequest` to include these configs

## Configuration

### Environment Variables for ConvoAI Lambda

```bash
# Point LLM to wrapper
LLM_URL=https://your-wrapper-domain.com/v1/chat/support

# LLM credentials
LLM_API_KEY=sk-proj-...
LLM_MODEL=gpt-4o

# Pass SIP and ConvoAI configs via LLM_PARAMS
LLM_PARAMS={"sipConfig":{"authToken":"LkP3sQ8jOvG7fI4mW1uA9eT2rH0yN5oX6zD2kV7p","callerId":"441473943851","agentPhone":"+447712886300","gateway":"agora-us-east.pstn.ashburn.twilio.com","region":"AREA_CODE_NA"},"convoAIConfig":{"authToken":"NzViOGUyY2M4MWZlNGU5NTk4YTBjOTIxN2U2NmE4NTg6MGRmMzcyOWRlODMwNGE2Y2E2MzYwMGRhYTkyMWQwMjk="}}

# Other existing vars
AGENT_AUTH_HEADER=Basic NzViOGUyY2M4MWZlNGU5NTk4YTBjOTIxN2U2NmE4NTg6MGRmMzcyOWRlODMwNGE2Y2E2MzYwMGRhYTkyMWQwMjk=
APP_ID=20b7c51ff4c644ab80cf5a4e646b0537
DEEPGRAM_KEY=9a15f1888c0f0e9d102e5ed47650da7f6f521882
DEFAULT_GREETING=Hi! I'm your support agent. How can I help you today?
DEFAULT_PROMPT=You are a helpful customer support agent.
RIME_API_KEY=3I7Gtcj6q-eGjjnsJEYA4hg-51WM8PCyOdViWN8chuc
TTS_VENDOR=rime
```

### LLM_PARAMS Format (Formatted)

```json
{
  "sipConfig": {
    "authToken": "LkP3sQ8jOvG7fI4mW1uA9eT2rH0yN5oX6zD2kV7p",
    "callerId": "441473943851",
    "agentPhone": "+447712886300",
    "gateway": "agora-us-east.pstn.ashburn.twilio.com",
    "region": "AREA_CODE_NA"
  },
  "convoAIConfig": {
    "authToken": "NzViOGUyY2M4MWZlNGU5NTk4YTBjOTIxN2U2NmE4NTg6MGRmMzcyOWRlODMwNGE2Y2E2MzYwMGRhYTkyMWQwMjk="
  }
}
```

**Note**: Agent ID is now looked up automatically from the ConvoAI API based on the channel.

## Usage Examples

### Example 1: Order Lookup

**User**: "What's my order status?"
**LLM**: "I can help you with that. Could you please provide your email address?"
**User**: "benweekes73@gmail.com"
**LLM**: *[calls lookup_order tool]*
**Tool returns**: Order details
**LLM**: "I found your order! Order #ORD-2025-12345 was shipped on November 1st..."

### Example 2: Human Handoff

**User**: "I need to speak to a human"
**LLM**: *[calls request_human_agent tool]*
**Tool executes**:
1. Calls SIP API → human's phone rings
2. Looks up agent ID from ConvoAI API (queries active agents in channel)
3. Calls ConvoAI `/leave` API → removes agent
**LLM**: "I'm connecting you to a human agent now. They'll be with you shortly..."
*Human answers phone and joins same RTC channel*

### Example 3: Combined Flow

**User**: "My order is late, I need help"
**LLM**: "Let me check that for you. What's your email address?"
**User**: "benweekes73@gmail.com"
**LLM**: *[calls lookup_order tool]*
**LLM**: "I see your order #ORD-2025-12345 is currently in transit with expected delivery on November 12th. Would you like me to connect you to a human agent who can investigate further?"
**User**: "Yes please"
**LLM**: *[calls request_human_agent tool]* → Handoff happens

## Request Format

The wrapper receives requests like this:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "I want to speak to a human"
    }
  ],
  "model": "gpt-4o",
  "baseURL": "https://api.openai.com/v1",
  "apiKey": "sk-proj-...",
  "stream": true,
  "appId": "20b7c51ff4c644ab80cf5a4e646b0537",
  "channel": "agora_iok2rg",
  "userId": "user123",

  "sipConfig": {
    "authToken": "LkP3sQ8jOvG7fI4mW1uA9eT2rH0yN5oX6zD2kV7p",
    "callerId": "441473943851",
    "agentPhone": "+447712886300",
    "gateway": "agora-us-east.pstn.ashburn.twilio.com",
    "region": "AREA_CODE_NA"
  },

  "convoAIConfig": {
    "authToken": "NzViOGUyY2M4MWZlNGU5NTk4YTBjOTIxN2U2NmE4NTg6MGRmMzcyOWRlODMwNGE2Y2E2MzYwMGRhYTkyMWQwMjk="
  }
}
```

**Note**: Agent ID is automatically looked up from the channel.

## Testing

### 1. Start the Wrapper Server

```bash
npm install
npm run dev
```

### 2. Test Order Lookup

```bash
curl -X POST https://your-wrapper-domain.com/v1/chat/support \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Check my order for benweekes73@gmail.com"}
    ],
    "model": "gpt-4o-mini",
    "appId": "20b7c51ff4c644ab80cf5a4e646b0537",
    "channel": "test-123",
    "userId": "user-456"
  }'
```

### 3. Test Human Handoff

```bash
curl -X POST https://your-wrapper-domain.com/v1/chat/support \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "I need to speak to a human"}
    ],
    "model": "gpt-4o-mini",
    "appId": "20b7c51ff4c644ab80cf5a4e646b0537",
    "channel": "test-123",
    "userId": "user-456",
    "sipConfig": {
      "authToken": "LkP3sQ8jOvG7fI4mW1uA9eT2rH0yN5oX6zD2kV7p",
      "callerId": "441473943851",
      "agentPhone": "+447712886300",
      "gateway": "agora-us-east.pstn.ashburn.twilio.com"
    },
    "convoAIConfig": {
      "authToken": "NzViOGUyY2M4MWZlNGU5NTk4YTBjOTIxN2U2NmE4NTg6MGRmMzcyOWRlODMwNGE2Y2E2MzYwMGRhYTkyMWQwMjk="
    }
  }'
```

## Troubleshooting

### Issue: "Missing sipConfig in request"
**Solution**: Make sure `LLM_PARAMS` includes `sipConfig` in your Lambda environment variables

### Issue: "Missing convoAIConfig in request"
**Solution**: Make sure `LLM_PARAMS` includes `convoAIConfig` (with authToken) in your Lambda environment variables

### Issue: "No active agent found in channel"
**Solution**: Make sure the ConvoAI agent is running in the channel before requesting handoff

### Issue: "Failed to trigger SIP call"
**Solution**: Check that:
- `sipConfig.authToken` is correct
- `sipConfig.agentPhone` is a valid phone number
- SIP API endpoint is reachable

### Issue: "Failed to stop ConvoAI agent"
**Solution**: Check that:
- `convoAIConfig.authToken` is correct
- ConvoAI agent is actually running in the channel
- ConvoAI API endpoint is reachable
- Agent lookup API is working (check logs for "Looking up agent ID")

## Next Steps

1. **Deploy the wrapper** to your hosting platform
2. **Update Lambda environment** with `LLM_URL` and `LLM_PARAMS`
3. **Test order lookup** with benweekes73@gmail.com
4. **Test human handoff** with real phone numbers
5. **Expand order lookup** to connect to real database (replace hardcoded data)
6. **Add more support policies** to `SUPPORT_RAG_DATA` in support-endpoint.ts

## Architecture

```
User → ConvoAI Agent → Wrapper (/v1/chat/support) → OpenAI
                            ↓
                     [Tools Execute]
                            ↓
         ┌──────────────────┴──────────────────┐
         ↓                                      ↓
  lookup_order                         request_human_agent
  (hardcoded)                          ↓              ↓
                                  SIP API      ConvoAI /leave
                                  (call)       (stop agent)
                                       ↓
                                Human joins channel
```

🎉 **Implementation Complete!**
