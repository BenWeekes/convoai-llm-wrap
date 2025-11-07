// lib/common/handoff-utils.ts
// Utilities for human handoff - SIP outbound call triggering and ConvoAI agent stopping

import axios from 'axios';
import type { SipConfig, ConvoAIConfig } from '../types';
import { createLogger } from './logger';

const logger = createLogger('HANDOFF');

/**
 * Generates a unique UID for the human agent joining via SIP
 */
export function generateHumanAgentUid(): string {
  return `human-${Date.now()}`;
}

/**
 * Triggers an outbound SIP call to connect a human agent to the channel
 *
 * @param appId - The Agora application ID
 * @param channel - The RTC channel name
 * @param userId - The user ID requesting human assistance
 * @param sipConfig - SIP configuration from request
 * @param reason - Reason for escalation
 * @returns Promise<boolean> - Success status
 */
export async function triggerOutboundCall(
  appId: string,
  channel: string,
  userId: string,
  sipConfig: SipConfig,
  reason: string
): Promise<boolean> {
  logger.info('Triggering outbound SIP call', {
    appId,
    channel,
    userId,
    reason,
    agentPhone: sipConfig.agentPhone
  });

  try {
    // Generate unique UID for the human agent
    const humanUid = generateHumanAgentUid();

    // Use appId as token (as per your requirements)
    const token = appId;

    // Make SIP API call
    const response = await axios.post(
      'https://sipcm.agora.io/v1/api/pstn',
      {
        action: "outbound",
        appid: appId,
        region: sipConfig.region || "AREA_CODE_NA",
        uid: humanUid,
        channel: channel,
        from: sipConfig.callerId,
        to: sipConfig.agentPhone,
        regional_gateways: "true",
        prompt: "false",
        sip: sipConfig.gateway,
        token: token
      },
      {
        headers: {
          'Authorization': `Basic ${sipConfig.authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('SIP call triggered successfully', {
      statusCode: response.status,
      humanUid,
      channel
    });

    return response.status === 200;
  } catch (error) {
    logger.error('Failed to trigger SIP call', {
      error: error instanceof Error ? error.message : 'Unknown error',
      appId,
      channel
    });
    return false;
  }
}

/**
 * Looks up the active agent ID for a given channel
 *
 * @param appId - The Agora application ID
 * @param channel - The RTC channel name
 * @param authToken - ConvoAI auth token
 * @returns Promise<string | null> - Agent ID or null if not found
 */
export async function lookupAgentId(
  appId: string,
  channel: string,
  authToken: string
): Promise<string | null> {
  logger.info('Looking up agent ID', { appId, channel });

  try {
    // Query the ConvoAI API to list agents
    const response = await axios.get(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/agents`,
      {
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.debug('Agents list response', {
      statusCode: response.status,
      agentCount: response.data?.agents?.length || 0
    });

    // Find agent in the specified channel
    const agents = response.data?.agents || [];
    const agentInChannel = agents.find((agent: any) =>
      agent.properties?.channel === channel &&
      agent.status === 'running'
    );

    if (agentInChannel) {
      logger.info('Found agent in channel', {
        agentId: agentInChannel.agent_id,
        channel
      });
      return agentInChannel.agent_id;
    }

    logger.warn('No active agent found in channel', { channel });
    return null;
  } catch (error) {
    logger.error('Failed to lookup agent ID', {
      error: error instanceof Error ? error.message : 'Unknown error',
      appId,
      channel
    });
    return null;
  }
}

/**
 * Stops the ConvoAI agent by calling the /leave API
 *
 * @param appId - The Agora application ID
 * @param channel - The RTC channel name
 * @param convoAIConfig - ConvoAI agent configuration from request
 * @returns Promise<boolean> - Success status
 */
export async function stopConvoAIAgent(
  appId: string,
  channel: string,
  convoAIConfig: ConvoAIConfig
): Promise<boolean> {
  logger.info('Stopping ConvoAI agent', {
    appId,
    channel
  });

  try {
    // Look up the agent ID for this channel
    const agentId = await lookupAgentId(appId, channel, convoAIConfig.authToken);

    if (!agentId) {
      logger.error('Cannot stop agent - no active agent found in channel', { channel });
      return false;
    }

    logger.debug('Found agent to stop', { agentId });

    const response = await axios.post(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/agents/${agentId}/leave`,
      {
        name: `leave-${Date.now()}`,
        properties: {
          channel: channel,
          token: appId,
          agent_rtc_uid: "0",
          remote_rtc_uids: ["*"],
          enable_string_uid: false,
          idle_timeout: 120,
          llm: {},
          asr: { language: "en-US" },
          tts: {}
        }
      },
      {
        headers: {
          'Authorization': `Basic ${convoAIConfig.authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('ConvoAI agent stopped successfully', {
      statusCode: response.status,
      agentId: agentId
    });

    return response.status === 200;
  } catch (error) {
    logger.error('Failed to stop ConvoAI agent', {
      error: error instanceof Error ? error.message : 'Unknown error',
      appId,
      channel
    });
    return false;
  }
}

/**
 * Packages conversation context for human agent (optional feature)
 *
 * @param conversation - The conversation object
 * @param reason - Reason for escalation
 * @returns Formatted context string
 */
export function packageConversationContext(conversation: any, reason: string): string {
  logger.debug('Packaging conversation context', { reason });

  if (!conversation || !conversation.messages) {
    return `Escalation reason: ${reason}`;
  }

  // Get last 5 messages for context
  const recentMessages = conversation.messages.slice(-5);
  const messageContext = recentMessages
    .map((msg: any) => `${msg.role}: ${msg.content}`)
    .join('\n');

  return `Escalation reason: ${reason}\n\nRecent conversation:\n${messageContext}`;
}
