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
