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

export interface EndpointConfig {
  ragData: Record<string, string>;
  tools: OpenAI.ChatCompletionTool[];
  toolMap: Record<string, (appId: string, userId: string, channel: string, args: any) => any>;
  systemMessageTemplate: (ragData: Record<string, string>) => string;
  communicationModes?: {
    supportsChat?: boolean;      // Enable RTM chat mode
    endpointMode?: 'voice' | 'video'; // What mode for API calls
  };
}
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