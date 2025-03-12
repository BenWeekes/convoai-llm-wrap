// File: lib/common/model-handler.ts
// Handles the LLM model requests with error recovery logic

import OpenAI from 'openai';
import { simplifyMessagesForLlama, isFollowUpWithToolResponsesPresent } from './utils';

/**
 * Attempts to call the LLM model with error recovery options
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
    
    // Special handling for Llama models
    if (typeof params.model === 'string' && 
        (params.model.toLowerCase().includes('llama') || params.model.toLowerCase().includes('trulience'))) {
      // For Llama models, keep tools but try with a simpler configuration
      try {
        console.log(`Attempting retry with Llama-specific configuration...`);
        
        // Create a deep clone of the parameters to avoid modifying original
        const llamaParams = JSON.parse(JSON.stringify(params));
        
        // Check if this is a follow-up after tool use and simplify if needed
        if (isFollowUpWithToolResponsesPresent(llamaParams.messages)) {
          llamaParams.messages = simplifyMessagesForLlama(llamaParams.messages);
        }
        // Otherwise check if we need to simplify the message history due to length
        else if (llamaParams.messages.length > 10) {
          console.log(`Message history is long (${llamaParams.messages.length}), truncating...`);
          // Keep the most recent messages
          const systemMessages = llamaParams.messages.filter((m: any) => m.role === 'system');
          const nonSystemMessages = llamaParams.messages.filter((m: any) => m.role !== 'system');
          // Take last 8 non-system messages
          const recentMessages = nonSystemMessages.slice(-8);
          llamaParams.messages = [...systemMessages, ...recentMessages];
        }
        
        return await openai.chat.completions.create(llamaParams);
      } catch (llamaError: any) {
        console.error(`Llama-specific retry failed:`, llamaError.message || 'Unknown error');
        
        // Last resort: Try without tools for Llama
        try {
          console.log(`Attempting last resort for Llama: no tools, simplified conversation...`);
          const lastResortParams = JSON.parse(JSON.stringify(params));
          
          // Find system messages and the last user message
          const systemMessages = lastResortParams.messages.filter((m: any) => m.role === 'system');
          const lastUserMessage = [...lastResortParams.messages].reverse().find((m: any) => m.role === 'user');
          
          if (lastUserMessage) {
            lastResortParams.messages = [...systemMessages, lastUserMessage];
            lastResortParams.tools = undefined;
            lastResortParams.tool_choice = undefined;
            
            return await openai.chat.completions.create(lastResortParams);
          }
        } catch (lastResortError) {
          console.error(`Last resort for Llama failed:`, lastResortError);
        }
        
        throw error; // Re-throw the original error if all Llama-specific approaches fail
      }
    }
    
    // If it's a 400 error for other models, try different approaches
    if (error.status === 400) {
      // Option 1: Try removing tool configuration if it's causing issues
      try {
        console.log(`Attempting fallback without tools...`);
        const noToolsParams = { ...params };
        // Only set these to undefined, don't delete them to avoid TypeScript errors
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
