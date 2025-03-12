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
  const url = `https://api.agora.io/dev/v2/project/${appId}/rtm/users/${fromUser}/peer_messages`;
  
  const data = {
    destination: String(toUser),
    enable_offline_messaging: true,
    enable_historical_messaging: true,
    payload
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        Authorization: 'Basic ' + process.env.REST_API_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    console.log('sendPeerMessage response:', response.data);
    return true;
  } catch (error) {
    console.error('Error sending peer message:', error);
    return false;
  }
}

/**
 * Sends a photo to a user via peer messaging
 * 
 * @param appId - The Agora application ID
 * @param fromUser - The sender's user ID
 * @param toUser - The recipient's user ID
 * @param photoType - The type of photo to send
 * @returns Promise<boolean> - Success status of the send operation
 */
export async function sendPhotoMessage(
  appId: string,
  fromUser: string, 
  toUser: string,
  photoType: string = "default"
): Promise<boolean> {
  // Map different photo types to different placeholder images
  let imageUrl = "https://sa-utils.agora.io/mms/kierap.png";
  
  /*
  if (photoType === "portrait") {
    imageUrl = "https://sa-utils.agora.io/mms/portrait.png";
  } else if (photoType === "landscape") {
    imageUrl = "https://sa-utils.agora.io/mms/landscape.png";
  } else if (photoType === "product") {
    imageUrl = "https://sa-utils.agora.io/mms/product.png";
  } else if (photoType === "face") {
    imageUrl = "https://sa-utils.agora.io/mms/kierap.png";
  }*/
  
  const payload = JSON.stringify({ img: imageUrl });
  
  return sendPeerMessage(appId, fromUser, toUser, payload);
}
