// File: lib/types.ts
// Contains all shared type definitions

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

export type EndpointConfig = {
  // The RAG data specific to this endpoint
  ragData: Record<string, string>;
  
  // The tools available for this endpoint
  tools: OpenAI.ChatCompletionTool[];
  
  // Implementation of the tools
  toolMap: ToolMap;
  
  // System message template to use
  systemMessageTemplate: (ragData: Record<string, string>) => string;
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
};