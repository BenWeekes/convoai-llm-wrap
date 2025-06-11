// File: lib/common/messaging-utils.ts
// Common messaging utilities with proper photo delay handling

import axios from 'axios';

/**
 * Sends a peer message through the Agora RTM system
 * This function can be used by any endpoint that needs to send messages/media
 * 
 * @param appId - The Agora application ID
 * @param fromUser - The sender's user ID
 * @param toUser - The recipient's user ID
 * @param payload - The message payload (usually JSON string)
 * @returns Promise<boolean> - Success status of the send operation
 */
export async function sendPeerMessage(
  appId: string, 
  fromUser: string, 
  toUser: string, 
  payload: string
): Promise<boolean> {
  console.log(`📤 sendPeerMessage called with:`, {
    appId,
    fromUser,
    toUser,
    payloadLength: payload.length
  });

  // Check required environment variables
  if (!process.env.REST_API_TOKEN) {
    console.error('❌ REST_API_TOKEN environment variable is missing');
    return false;
  }

  const url = `https://api.agora.io/dev/v2/project/${appId}/rtm/users/${fromUser}/peer_messages`;
  console.log(`📤 Request URL:`, url);
  
  const data = {
    destination: String(toUser),
    enable_offline_messaging: true,
    enable_historical_messaging: true,
    payload
  };

  try {
    console.log(`📤 Making request with data:`, data);
    console.log(`📤 Using REST_API_TOKEN (first 10 chars):`, process.env.REST_API_TOKEN?.substring(0, 10) + '...');
    
    const response = await axios.post(url, data, {
      headers: {
        Authorization: 'Basic ' + process.env.REST_API_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ sendPeerMessage response status:', response.status);
    console.log('✅ sendPeerMessage response data:', response.data);
    return true;
  } catch (error: any) {
    console.error('❌ Error sending peer message:', error.message);
    if (error.response) {
      console.error('❌ Response status:', error.response.status);
      console.error('❌ Response data:', error.response.data);
      console.error('❌ Response headers:', error.response.headers);
    }
    if (error.request) {
      console.error('❌ Request that was made:', error.request);
    }
    return false;
  }
}

/**
 * Sends a photo message with configurable delay (non-blocking)
 * 
 * @param appId - The Agora application ID
 * @param fromUser - The sender's user ID  
 * @param toUser - The recipient's user ID
 * @param imageUrl - The URL of the image to send
 * @param delayMs - Delay in milliseconds before sending (default: 3000ms)
 * @returns Promise<boolean> - Resolves immediately with true (actual send happens after delay)
 */
export async function sendPhotoMessage(
  appId: string,
  fromUser: string, 
  toUser: string,
  imageUrl: string,
  delayMs: number = 3000
): Promise<boolean> {
  console.log(`📸 sendPhotoMessage called with:`, {
    appId,
    fromUser,
    toUser,
    imageUrl,
    delayMs
  });

  // Check required environment variables
  if (!process.env.REST_API_TOKEN) {
    console.error('❌ REST_API_TOKEN environment variable is missing');
    return false;
  }

  const payload = JSON.stringify({ img: imageUrl });
  console.log(`📸 Scheduling photo with ${delayMs}ms delay:`, payload);
  
  // Schedule the photo to be sent after delay (non-blocking)
  setTimeout(async () => {
    try {
      console.log(`📸 Sending delayed photo to ${toUser} (delay: ${delayMs}ms)`);
      const result = await sendPeerMessage(appId, fromUser, toUser, payload);
      
      if (result) {
        console.log(`📸 ✅ Delayed photo sent successfully to ${toUser}`);
      } else {
        console.log(`📸 ❌ Failed to send delayed photo to ${toUser}`);
      }
    } catch (error) {
      console.error(`📸 ❌ Error sending delayed photo to ${toUser}:`, error);
    }
  }, delayMs);
  
  console.log(`📸 Photo scheduled for ${toUser} (will send in ${delayMs}ms)`);
  
  // Return true immediately - the actual sending happens asynchronously
  return true;
}

/**
 * Sends a photo message immediately (for backwards compatibility)
 */
export async function sendPhotoMessageImmediate(
  appId: string,
  fromUser: string, 
  toUser: string,
  imageUrl: string 
): Promise<boolean> {
  return sendPhotoMessage(appId, fromUser, toUser, imageUrl, 0);
}