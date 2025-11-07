// File: lib/types.ts
// Contains all shared type definitions - simplified without source property
// Added prependUserId configuration option

import type OpenAI from 'openai';

export type ToolResponseCacheItem = {
  toolCallId: string;
  toolName: string;
  content: string;
  timestamp: number;
};

export type RequestWithJson = Request & {
  json: () => Promise<any>;
};

export type ToolFunction = (appId: string, userId: string, channel: string, args: any) => Promise<string> | string;

export type ToolMap = Record<string, ToolFunction>;

export type RTMSessionParams = {
  enable_rtm?: boolean;
  agent_rtm_uid?: string;
  agent_rtm_token?: string;
  agent_rtm_channel?: string;
};

// Simplified Message interface - no source property
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  mode?: 'chat' | 'voice' | 'video'; // chat = RTM, voice/video = endpoints
  timestamp?: number;
}

// Simplified Conversation interface
export interface Conversation {
  appId: string;
  userId: string;
  messages: Message[];
  lastUpdated: number;
  rtmSystemMessage?: string;
  lastSystemMessageHash?: string;
}

export interface EndpointConfig {
  ragData: Record<string, string>;
  tools: OpenAI.ChatCompletionTool[];
  toolMap: Record<string, (appId: string, userId: string, channel: string, args: any) => any>;
  systemMessageTemplate: (ragData: Record<string, string>) => string;
  communicationModes?: {
    supportsChat?: boolean;      // Enable RTM chat mode
    endpointMode?: 'voice' | 'video'; // What mode for API calls
    prependUserId?: boolean;     // Enable user ID prepending to messages
    prependCommunicationMode?: boolean; // Enable communication mode prefixing to messages
  };
}

export type SipConfig = {
  authToken: string;
  region?: string;
  callerId: string;
  agentPhone: string;
  gateway: string;
};

export type ConvoAIConfig = {
  authToken: string;
};

export type EndpointRequest = {
  messages: any[];
  model?: string;
  baseURL?: string;
  stream?: boolean;
  channel?: string;
  userId?: string;
  appId: string;
  simplifiedTools?: boolean;
  stream_options?: any;

  // RTM parameters
  enable_rtm?: boolean;
  agent_rtm_uid?: string;
  agent_rtm_token?: string;
  agent_rtm_channel?: string;

  // SIP configuration (for human handoff)
  sipConfig?: SipConfig;

  // ConvoAI agent configuration (for stopping agent)
  convoAIConfig?: ConvoAIConfig;
};