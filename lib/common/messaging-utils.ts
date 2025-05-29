// File: lib/common/messaging-utils.ts
// Common messaging utilities that can be used across endpoints

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


export async function sendPhotoMessage(
  appId: string,
  fromUser: string, 
  toUser: string,
  imageUrl: string 
): Promise<boolean> {
  console.log(`📸 sendPhotoMessage called with:`, {
    appId,
    fromUser,
    toUser,
    imageUrl
  });

  // Check required environment variables
  if (!process.env.REST_API_TOKEN) {
    console.error('❌ REST_API_TOKEN environment variable is missing');
    return false;
  }

  
  const payload = JSON.stringify({ img: imageUrl });
  console.log(`📸 Sending photo payload:`, payload);
  await new Promise(r => setTimeout(r, 1000));
  try {
    const result = await sendPeerMessage(appId, fromUser, toUser, payload);
    console.log(`📸 sendPhotoMessage result:`, result);
    return result;
  } catch (error) {
    console.error('📸 sendPhotoMessage error:', error);
    return false;
  }
}