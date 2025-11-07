// lib/endpoints/support-endpoint.ts
// Support endpoint configuration with human handoff and order lookup tools

import OpenAI from 'openai';
import type { EndpointConfig, SipConfig, ConvoAIConfig } from '../types';
import { triggerOutboundCall, stopConvoAIAgent } from '../common/handoff-utils';
import { lookupOrder } from '../common/order-utils';
import { toolLogger, createLogger } from '../common/logger';

const logger = createLogger('SUPPORT-ENDPOINT');

// Define RAG data for support endpoint
const SUPPORT_RAG_DATA = {
  policy1: "We offer 30-day returns on all items.",
  policy2: "Shipping is free on orders over $50.",
  policy3: "Customer support is available 24/7.",
  policy4: "We accept all major credit cards and PayPal."
};

/**
 * System message template for customer support
 */
function supportSystemTemplate(ragData: Record<string, string>): string {
  return `You are a helpful customer support agent. Your goal is to assist customers with their orders and issues.

CAPABILITIES:
1. You can look up orders using the customer's email address
2. You can escalate to a human agent when needed

WHEN TO ESCALATE TO HUMAN:
- Customer explicitly asks to speak with a human
- Issue is too complex for you to resolve
- Customer is frustrated or angry
- Order modifications or refunds are needed
- Payment or billing issues
- Any situation where human judgment is required

HOW TO ESCALATE:
- Use the request_human_agent tool
- Explain to the customer that you're connecting them to a human agent
- Always provide a reason for the escalation

ORDER LOOKUP:
- ONLY ask for email if customer requests order status, tracking, or order information
- Don't ask for email for general support questions
- Once you have the email, use the lookup_order tool to retrieve order details
- Summarize the key information for the customer
- Offer to help with any order-related questions

TONE:
- Friendly and professional
- Empathetic to customer concerns
- Clear and concise in responses
- Patient and understanding

POLICIES:
- ${ragData.policy1}
- ${ragData.policy2}
- ${ragData.policy3}
- ${ragData.policy4}

Remember: Keep responses concise and helpful. If in doubt, escalate to a human agent.`;
}

// Define the tools for this endpoint
const SUPPORT_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "request_human_agent",
      description: "Escalate the conversation to a human agent via phone call. Use this when the customer needs human assistance or explicitly requests it.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for escalation (e.g., 'complex issue', 'user request', 'refund needed', 'frustrated customer')"
          },
          urgency: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Urgency level of the request"
          }
        },
        required: ["reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_order",
      description: "Look up customer order information by email address. Only use this when the customer provides or you've asked for their email.",
      parameters: {
        type: "object",
        properties: {
          email: {
            type: "string",
            description: "Customer's email address"
          }
        },
        required: ["email"]
      }
    }
  }
];

/**
 * Tool function: Request human agent
 * Triggers SIP outbound call and stops ConvoAI agent
 */
async function request_human_agent(
  appId: string,
  userId: string,
  channel: string,
  args: any,
  sipConfig?: SipConfig,
  convoAIConfig?: ConvoAIConfig
): Promise<string> {
  const reason = args?.reason || "user_request";
  const urgency = args?.urgency || "medium";

  toolLogger.info('Human agent requested', {
    appId,
    userId,
    channel,
    reason,
    urgency
  });

  // Validate required configurations
  if (!sipConfig) {
    toolLogger.error('Missing sipConfig in request');
    return 'Unable to connect to human agent: missing SIP configuration. Please contact support directly.';
  }

  if (!convoAIConfig) {
    toolLogger.error('Missing convoAIConfig in request');
    return 'Unable to connect to human agent: missing agent configuration. Please contact support directly.';
  }

  try {
    // Step 1: Trigger outbound SIP call
    toolLogger.debug('Triggering SIP outbound call');
    const sipSuccess = await triggerOutboundCall(appId, channel, userId, sipConfig, reason);

    if (!sipSuccess) {
      toolLogger.error('SIP call failed');
      return 'I apologize, but I was unable to connect you to a human agent at this time. Please try again in a moment or contact us directly.';
    }

    // Step 2: Stop the ConvoAI agent
    toolLogger.debug('Stopping ConvoAI agent');
    const stopSuccess = await stopConvoAIAgent(appId, channel, convoAIConfig);

    if (!stopSuccess) {
      toolLogger.warn('Agent stop call failed, but SIP call succeeded');
      // Continue anyway - the SIP call was successful
    }

    toolLogger.info('Human handoff completed successfully', {
      userId,
      channel,
      reason
    });

    return `I'm connecting you to a human agent now. They'll be with you shortly to help with: ${reason}. Please stay on the line.`;
  } catch (error) {
    toolLogger.error('Error during human handoff', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
      channel
    });
    return 'I apologize, but I encountered an error while connecting you to a human agent. Please try again or contact support directly.';
  }
}

/**
 * Tool function: Look up order
 * Returns order information for the given email
 */
function lookup_order_tool(
  appId: string,
  userId: string,
  channel: string,
  args: any
): string {
  const email = args?.email;

  toolLogger.info('Order lookup requested', {
    appId,
    userId,
    channel,
    email
  });

  if (!email) {
    toolLogger.warn('Order lookup called without email');
    return 'Please provide your email address to look up your order.';
  }

  const result = lookupOrder(email);

  toolLogger.debug('Order lookup result', {
    email,
    found: result.includes('Order #')
  });

  return result;
}

// Create the tool map with enhanced handling
// Note: We need to get sipConfig and convoAIConfig from somewhere accessible
// We'll handle this by storing them in a request context or passing them through
let requestSipConfig: SipConfig | undefined;
let requestConvoAIConfig: ConvoAIConfig | undefined;

/**
 * Sets the request-level SIP and ConvoAI configs
 * This is called by the endpoint handler before tool execution
 */
export function setRequestConfigs(sipConfig?: SipConfig, convoAIConfig?: ConvoAIConfig) {
  requestSipConfig = sipConfig;
  requestConvoAIConfig = convoAIConfig;
}

const SUPPORT_TOOL_MAP = {
  request_human_agent: async (appId: string, userId: string, channel: string, args: any) => {
    toolLogger.trace('Tool map: request_human_agent wrapper called', { channel });
    try {
      const result = await request_human_agent(
        appId,
        userId,
        channel,
        args,
        requestSipConfig,
        requestConvoAIConfig
      );
      toolLogger.trace('Tool map: request_human_agent completed');
      return result;
    } catch (error) {
      toolLogger.error('Tool map: request_human_agent error', error);
      throw error;
    }
  },
  lookup_order: (appId: string, userId: string, channel: string, args: any) => {
    toolLogger.trace('Tool map: lookup_order wrapper called', { channel, args });
    try {
      const result = lookup_order_tool(appId, userId, channel, args);
      toolLogger.trace('Tool map: lookup_order completed');
      return result;
    } catch (error) {
      toolLogger.error('Tool map: lookup_order error', error);
      throw error;
    }
  }
};

// Log endpoint initialization
logger.info('Support endpoint initialized', {
  tools: Object.keys(SUPPORT_TOOL_MAP),
  hasHandoffCapability: true,
  hasOrderLookup: true
});

// Export the complete endpoint configuration
export const supportEndpointConfig: EndpointConfig = {
  ragData: SUPPORT_RAG_DATA,
  tools: SUPPORT_TOOLS,
  toolMap: SUPPORT_TOOL_MAP,
  systemMessageTemplate: supportSystemTemplate,
  communicationModes: {
    supportsChat: true,           // Support text chat + voice
    endpointMode: 'voice',         // This is a voice/call endpoint
    prependUserId: false,          // Don't prefix with user ID for single-user support
    prependCommunicationMode: false // Don't prefix with mode for cleaner experience
  }
};
