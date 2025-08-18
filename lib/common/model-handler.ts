// File: lib/common/model-handler.ts
// Improved model handler with better error handling and message cleaning
// FIXED: Always sanitizes messages to remove non-standard properties before sending to LLM
// FIXED: Now uses proper logging system instead of console.log

import OpenAI from 'openai';
import { createLogger } from './logger';

// Create logger for model handler
const logger = createLogger('MODEL-HANDLER');

/**
 * Sanitize messages to ensure they only contain standard OpenAI properties
 * This is a final safety check before sending to any LLM
 * Prevents errors like "property 'mode' is unsupported" from Groq and other strict APIs
 */
function sanitizeMessages(messages: any[]): any[] {
  return messages.map(msg => {
    const cleaned: any = {
      role: msg.role,
      content: msg.content || ''
    };
    
    // Only include standard OpenAI properties if they exist
    if (msg.name) cleaned.name = msg.name;
    if (msg.tool_calls) cleaned.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) cleaned.tool_call_id = msg.tool_call_id;
    
    // Explicitly exclude all non-standard properties:
    // - mode (internal tracking for chat/voice/video)
    // - timestamp (internal tracking)
    // - metadata (internal tracking)
    // - turn_id (internal tracking)
    // - any other custom properties
    
    return cleaned;
  });
}

/**
 * Attempts to call the LLM model with comprehensive error recovery
 * Ensures messages are properly sanitized before sending
 */
export async function handleModelRequest(
  openai: OpenAI, 
  params: any, 
  fallbackModel = 'gpt-3.5-turbo'
): Promise<any> {
  // ALWAYS sanitize messages before sending to any LLM
  // This prevents errors with strict APIs like Groq that reject non-standard properties
  const sanitizedParams = {
    ...params,
    messages: sanitizeMessages(params.messages)
  };
  
  logger.trace(`Sanitized ${params.messages.length} messages for LLM request`, {
    model: params.model,
    originalMessageCount: params.messages.length,
    hasTools: !!params.tools
  });
  
  try {
    // Try to make the request with the original model and sanitized parameters
    return await openai.chat.completions.create(sanitizedParams);
  } catch (error: any) {
    // Log the error for debugging
    logger.error(`Error making request with model ${params.model}`, {
      error: error.message || 'Unknown error',
      status: error.status,
      code: error.code
    });
    
    // Check if it's a property-related error (should be prevented by sanitization)
    if (error.message?.includes('property') && error.message?.includes('unsupported')) {
      logger.error('Message contained unsupported properties - this should have been caught by sanitization', {
        errorDetail: error.message,
        messageCount: params.messages.length
      });
      
      // Log the problematic messages in debug mode for investigation
      logger.debug('Problematic messages', {
        messages: JSON.stringify(params.messages, null, 2)
      });
    }
    
    // If it's a 400 error, try various fallbacks
    if (error.status === 400 || error.message?.includes('400')) {
      logger.info('Attempting fallback strategies for 400 error');
      
      // Option 1: Try removing tool configuration if it's causing issues
      try {
        logger.debug('Fallback 1: Attempting without tools...');
        const noToolsParams = { ...sanitizedParams };
        delete noToolsParams.tools;
        delete noToolsParams.tool_choice;
        
        const result = await openai.chat.completions.create(noToolsParams);
        logger.info('Fallback 1 successful: Request completed without tools');
        return result;
      } catch (fallbackError: any) {
        logger.warn('Fallback 1 failed: Without tools', {
          error: fallbackError.message || 'Unknown error'
        });
        
        // Option 2: Try with a different model
        try {
          logger.debug(`Fallback 2: Attempting with fallback model ${fallbackModel}...`);
          const fallbackModelParams = { 
            ...sanitizedParams, 
            model: fallbackModel 
          };
          delete fallbackModelParams.tools;
          delete fallbackModelParams.tool_choice;
          
          const result = await openai.chat.completions.create(fallbackModelParams);
          logger.info(`Fallback 2 successful: Request completed with ${fallbackModel}`);
          return result;
        } catch (modelFallbackError: any) {
          logger.warn(`Fallback 2 failed: With model ${fallbackModel}`, {
            error: modelFallbackError.message || 'Unknown error'
          });
          
          // Option 3: Try with minimal parameters
          try {
            logger.debug('Fallback 3: Attempting with minimal parameters...');
            const minimalParams = {
              model: fallbackModel,
              messages: sanitizeMessages(params.messages),
              temperature: 0.7,
              max_tokens: 1000
            };
            
            const result = await openai.chat.completions.create(minimalParams);
            logger.info('Fallback 3 successful: Request completed with minimal params');
            return result;
          } catch (minimalError: any) {
            logger.error('Fallback 3 failed: All fallback strategies exhausted', {
              error: minimalError.message || 'Unknown error'
            });
            
            // Re-throw the original error if all fallbacks fail
            throw error;
          }
        }
      }
    } else {
      // For other types of errors, just re-throw
      logger.debug('Non-400 error, re-throwing without fallback attempts');
      throw error;
    }
  }
}