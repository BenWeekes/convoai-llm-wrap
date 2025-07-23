// lib/common/system-prompt-helpers.ts
// Shared system prompt context generation based on endpoint configuration
// Automatically generates instructions for prefixing behavior and communication modes

import type { EndpointConfig } from '../types';

/**
 * Generate user ID prefixing instructions if enabled
 */
export function generateUserIdPrefixInstructions(config: EndpointConfig): string {
  if (!config.communicationModes?.prependUserId) {
    return '';
  }

  return `

USER ID IDENTIFICATION:
- User messages are automatically prefixed with their user ID in brackets (e.g., "[Alice] Hello there" or "[Bob123] How are you?")
- The user ID in brackets represents the person's name or identifier who spoke/typed that message
- When responding, you can address specific users: "Thanks Alice!" or "@Bob123, great question!"
- You can address multiple users or the whole group: "Hi everyone!" or mention specific users by their names
- Use natural language when referring to users (use their name from the bracket, not the full bracket format)

EXAMPLE USER ID INTERACTIONS:
- If you see "[Sarah] Can you help me with math?" respond like "Hi Sarah! I'd be happy to help you with math."
- If you see "[Mike] Thanks!" and "[Lisa] What about science?" you can respond to both: "You're welcome Mike! And Lisa, I can definitely help with science too."
- For group discussions: "That's a great point, Alex! What do you think about that, Maria?"`;
}

/**
 * Generate communication mode prefixing instructions if enabled
 */
export function generateCommunicationModePrefixInstructions(config: EndpointConfig): string {
  if (!config.communicationModes?.prependCommunicationMode) {
    return '';
  }

  return `

COMMUNICATION MODE IDENTIFICATION:
- User messages are prefixed with their communication mode in brackets: [CHAT], [VIDEO CALL], or [VOICE CALL]
- [CHAT] indicates the user is texting/typing (they can only see text responses)
- [VIDEO CALL] indicates the user is on a video call (they can see and hear you)
- [VOICE CALL] indicates the user is on a voice call (they can hear you but not see you)
- Respond appropriately based on the communication mode shown in the message prefix

EXAMPLE COMMUNICATION MODE INTERACTIONS:
- "[CHAT] How are you?" → Respond with text-appropriate language
- "[VIDEO CALL] Can you show me that?" → You can reference visual elements since they can see you
- "[VOICE CALL] What was that sound?" → Focus on audio/verbal communication`;
}

/**
 * Generate available communication modes context
 */
export function generateAvailableModesContext(config: EndpointConfig): string {
  if (!config.communicationModes) {
    return '';
  }

  const { supportsChat, endpointMode } = config.communicationModes;
  
  if (!supportsChat && !endpointMode) {
    return '';
  }

  const availableModes: string[] = [];
  let currentModeDescription = '';

  // Determine available modes
  if (supportsChat) {
    availableModes.push('chat');
  }
  if (endpointMode === 'video') {
    availableModes.push('video');
    currentModeDescription = endpointMode === 'video' 
      ? 'VIDEO (user is on video call with you right now - they can see and hear you)'
      : '';
  } else if (endpointMode === 'voice') {
    availableModes.push('voice');
    currentModeDescription = 'VOICE (user is on voice call with you right now - they can hear you)';
  }

  if (availableModes.length === 0) {
    return '';
  }

  let modeContext = `

COMMUNICATION MODES:`;

  // Add current mode if this is an endpoint call
  if (currentModeDescription) {
    modeContext += `
- CURRENT MODE: ${currentModeDescription}`;
  }

  // Add available modes
  modeContext += `
- AVAILABLE MODES: ${availableModes.join(', ')}`;

  // Add mode-specific guidance
  if (availableModes.includes('chat') && availableModes.length > 1) {
    if (endpointMode === 'video') {
      modeContext += `
- You can suggest switching between chat and video as appropriate for the conversation`;
    } else if (endpointMode === 'voice') {
      modeContext += `
- You can suggest switching between chat and voice as appropriate for the conversation`;
    }
  }

  return modeContext;
}

/**
 * Generate group conversation context if user ID prefixing is enabled
 */
export function generateGroupConversationContext(config: EndpointConfig): string {
  if (!config.communicationModes?.prependUserId) {
    return '';
  }

  return `

GROUP CONVERSATION GUIDELINES:
- This is a multi-user environment where multiple people can participate
- Pay close attention to WHO is speaking (user names/IDs shown in brackets before their messages)
- You can facilitate conversations between users
- Address users by their name/ID when relevant for personalization
- Keep track of different users' contexts, questions, and needs
- Encourage group participation and help users interact with each other when appropriate`;
}

/**
 * Generate complete system message context based on endpoint configuration
 */
export function generateSystemMessageContext(config: EndpointConfig): string {
  const contexts: string[] = [];

  // Add user ID prefixing instructions
  const userIdContext = generateUserIdPrefixInstructions(config);
  if (userIdContext) {
    contexts.push(userIdContext);
  }

  // Add communication mode prefixing instructions
  const modeContext = generateCommunicationModePrefixInstructions(config);
  if (modeContext) {
    contexts.push(modeContext);
  }

  // Add available modes context
  const availableModesContext = generateAvailableModesContext(config);
  if (availableModesContext) {
    contexts.push(availableModesContext);
  }

  // Add group conversation context
  const groupContext = generateGroupConversationContext(config);
  if (groupContext) {
    contexts.push(groupContext);
  }

  return contexts.join('');
}

/**
 * Enhanced system message builder that automatically adds configuration-based context
 */
export function buildEnhancedSystemMessage(
  baseSystemMessage: string,
  config: EndpointConfig,
  customContext?: string
): string {
  let enhancedMessage = baseSystemMessage;

  // Add custom context if provided
  if (customContext) {
    enhancedMessage += `\n\n${customContext}`;
  }

  // Add automatic configuration-based context
  const autoContext = generateSystemMessageContext(config);
  if (autoContext) {
    enhancedMessage += autoContext;
  }

  return enhancedMessage;
}
