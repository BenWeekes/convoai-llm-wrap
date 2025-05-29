// File: lib/common/cache.ts
// This file contains the shared caching functionality
// Enhanced with debug logging configuration

import type { ToolResponseCacheItem } from '../types';

// Configuration options
export const CONFIG = {
  // Set to false to disable detailed response logging (reduces console output)
  enableDetailedResponseLogging: false, // CHANGED: Set to false by default for quieter logs
  
  // NEW: LLM Debug Logging Configuration
  enableLLMRequestLogging: true,      // Log what's sent to LLM
  enableLLMResponseLogging: true,     // Log what LLM responds with
  enableStreamingChunkLogging: false, // Log individual streaming chunks (very verbose)
  enableModeTransitionLogging: true,  // Log communication mode changes
  enableConversationLogging: true,    // Log conversation context and mode analysis
  enableRTMMessageLogging: true,      // Log RTM message processing
  
  // Cache configuration
  cacheExpirationMs: 86400000,       // Cache expiration time in milliseconds (24 hours)
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
}

export function getToolResponse(toolCallId: string): ToolResponseCacheItem | null {
  const item = toolResponseCache[toolCallId];
  if (!item) return null;
  
  // Check if item has expired
  if (Date.now() - item.timestamp > CONFIG.cacheExpirationMs) {
    // Remove expired item
    delete toolResponseCache[toolCallId];
    return null;
  }
  
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
    console.log(`Cleaned up ${expiredCount} expired tool response entries from cache`);
  }
}

// Schedule cleanup at the specified interval
setInterval(cleanupExpiredResponses, CONFIG.cleanupIntervalMs);

// Helper for debugging the cache
export function logCacheState(): void {
  console.log("Current Tool Response Cache State:");
  console.log(`Total cached items: ${Object.keys(toolResponseCache).length}`);
  
  if (Object.keys(toolResponseCache).length > 0) {
    Object.values(toolResponseCache).forEach(item => {
      const ageInHours = (Date.now() - item.timestamp) / 3600000;
      console.log(`- ID: ${item.toolCallId.substring(0, 8)}..., Tool: ${item.toolName}, Age: ${ageInHours.toFixed(2)} hours`);
    });
  }
}