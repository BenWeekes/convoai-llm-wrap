// File: lib/common/model-handler.ts
// Simplified model handler with no special casing - all models get same treatment

import OpenAI from 'openai';

/**
 * Attempts to call the LLM model with basic error recovery
 * No special casing - all models receive standardized, compliant messages
 */
export async function handleModelRequest(
  openai: OpenAI, 
  params: any, 
  fallbackModel = 'gpt-3.5-turbo'
): Promise<any> {
  try {
    // Try to make the request with the original model and parameters
    return await openai.chat.completions.create(params);
  } catch (error: any) {
    // Log the error for debugging
    console.error(`Error making request with model ${params.model}:`, error.message || 'Unknown error');
    
    // If it's a 400 error, try basic fallbacks
    if (error.status === 400) {
      // Option 1: Try removing tool configuration if it's causing issues
      try {
        console.log(`Attempting fallback without tools...`);
        const noToolsParams = { ...params };
        noToolsParams.tools = undefined;
        noToolsParams.tool_choice = undefined;
        
        return await openai.chat.completions.create(noToolsParams);
      } catch (fallbackError: any) {
        console.error(`Fallback without tools failed:`, fallbackError.message || 'Unknown error');
        
        // Option 2: Try with a different model
        try {
          console.log(`Attempting with fallback model ${fallbackModel}...`);
          const fallbackModelParams = { ...params, model: fallbackModel };
          
          return await openai.chat.completions.create(fallbackModelParams);
        } catch (modelFallbackError: any) {
          console.error(`Fallback model failed:`, modelFallbackError.message || 'Unknown error');
          // Re-throw the original error if all fallbacks fail
          throw error;
        }
      }
    } else {
      // For other types of errors, just re-throw
      throw error;
    }
  }
}