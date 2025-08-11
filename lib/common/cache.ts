// File: lib/common/cache.ts
// This file contains the shared caching functionality
// Updated with proper logging system

import type { ToolResponseCacheItem } from '../types';
import { cacheLogger as logger } from './logger';

// Configuration options
export const CONFIG = {
  // Logging configuration (now controlled by LOG_LEVEL env var)
  enableDetailedResponseLogging: false, // Set to false by default for quieter logs
  enableLLMRequestLogging: true,       // Log what's sent to LLM
  enableLLMResponseLogging: true,      // Log what LLM responds with
  enableStreamingChunkLogging: false,  // Log individual streaming chunks (very verbose)
  enableModeTransitionLogging: true,   // Log communication mode changes
  enableConversationLogging: true,     // Log conversation context and mode analysis
  enableRTMMessageLogging: true,       // Log RTM message processing
  
  // Cache configuration
  cacheExpirationMs: 86400000,        // Cache expiration time in milliseconds (24 hours)
  cleanupIntervalMs: 60000            // Interval for cleaning up expired cache entries (1 minute)
};

// Global cache to store tool responses (will be shared across requests)
const toolResponseCache: Record<string, ToolResponseCacheItem> = {};

// Cache management functions
export function storeToolResponse(toolCallId: string, toolName: string, content: string): void {
  toolResponseCache[toolCallId] = {
    toolCallId,
    toolName,
    content,
    timestamp: Date.now()
  };
  
  logger.debug(`Stored tool response for ${toolName}`, { toolCallId: toolCallId.substring(0, 8) });
}

export function getToolResponse(toolCallId: string): ToolResponseCacheItem | null {
  const item = toolResponseCache[toolCallId];
  if (!item) {
    logger.trace(`Tool response not found in cache`, { toolCallId: toolCallId.substring(0, 8) });
    return null;
  }
  
  // Check if item has expired
  if (Date.now() - item.timestamp > CONFIG.cacheExpirationMs) {
    // Remove expired item
    delete toolResponseCache[toolCallId];
    logger.debug(`Removed expired tool response from cache`, { 
      toolCallId: toolCallId.substring(0, 8),
      toolName: item.toolName 
    });
    return null;
  }
  
  logger.trace(`Retrieved tool response from cache`, { 
    toolCallId: toolCallId.substring(0, 8),
    toolName: item.toolName 
  });
  return item;
}

// This runs every minute to proactively clean the cache
export function cleanupExpiredResponses(): void {
  const now = Date.now();
  let expiredCount = 0;
  
  Object.keys(toolResponseCache).forEach(key => {
    if (now - toolResponseCache[key].timestamp > CONFIG.cacheExpirationMs) {
      delete toolResponseCache[key];
      expiredCount++;
    }
  });
  
  if (expiredCount > 0) {
    logger.info(`Cleaned up expired tool responses`, { count: expiredCount });
  }
}

// Schedule cleanup at the specified interval
setInterval(cleanupExpiredResponses, CONFIG.cleanupIntervalMs);

// Helper for debugging the cache
export function logCacheState(): void {
  const cacheSize = Object.keys(toolResponseCache).length;
  
  if (cacheSize === 0) {
    logger.debug('Cache is empty');
    return;
  }
  
  const cacheItems = Object.values(toolResponseCache).map(item => ({
    id: item.toolCallId.substring(0, 8),
    tool: item.toolName,
    age: `${((Date.now() - item.timestamp) / 3600000).toFixed(2)}h`
  }));
  
  logger.debug(`Cache state: ${cacheSize} items`, cacheItems);
}

// Log initialization
logger.info('Tool response cache initialized', {
  expirationTime: `${CONFIG.cacheExpirationMs / 3600000} hours`,
  cleanupInterval: `${CONFIG.cleanupIntervalMs / 60000} minutes`
});