// File: lib/endpoints/language-tutor-endpoint.ts
// Configuration for the language tutor endpoint

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';
import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize firestore service if not already initialized
let firestoreInitialized = false;
let firestoreClient: any = null;

// Firestore document paths
const DOC_EXPIRE_PATH = "expireAt";
const DOC_WORDS_PATH = "words";

// Default TTL for documents
const DEFAULT_TTL = 1; // day

// Define minimal RAG data (will be ignored as system message comes from messages param)
const LANGUAGE_TUTOR_RAG_DATA = {};

// Define a minimal system template function that doesn't add any instructions
// The actual system message will come from the messages parameter
function languageTutorSystemTemplate(ragData: Record<string, string>): string {
  return ``; // Empty string as we'll use the system message from the messages parameter
}

// Define the tools for this endpoint
const LANGUAGE_TUTOR_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_word_list",
      description: "Call this to fetch the list of words the user is to be tested on. Each word has a state: true (correct in the past), false (wrong in the past), or new (never tested).",
      parameters: {
        type: "object",
        properties: {
          dummy: {
            type: "string",
            description: "Not used. Provide empty or any string."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_word_result",
      description: "Record whether the user got the translation correct (true) or incorrect (false). Call this function after each word is tested.",
      parameters: {
        type: "object",
        properties: {
          word: {
            type: "string",
            description: "The tested word."
          },
          correct: {
            type: "boolean",
            description: "Set to true if the user was correct, or false if the user was wrong."
          }
        },
        required: ["word", "correct"]
      }
    }
  }
];

// Helper to ensure Firestore is initialized
async function ensureFirestoreInit(appId: string): Promise<any> {
  if (!firestoreInitialized || !firestoreClient) {
    try {
      console.log(`Initializing Firestore for appId: ${appId}`);
      
      // Get Firebase configuration from environment variables
      const projectId = process.env.FIRESTORE_PROJECT_ID;
      const privateKey = process.env.FIRESTORE_PRIVATE_KEY?.replace(/\\n/g, '\n'); // Fix newlines if needed
      const clientEmail = process.env.FIRESTORE_CLIENT_EMAIL;
      
      if (!projectId || !privateKey || !clientEmail) {
        throw new Error("Missing Firebase configuration in environment variables");
      }
      
      // Create the service account object in the correct format
      const serviceAccount: ServiceAccount = {
        projectId,
        privateKey,
        clientEmail
      };
      
      // Initialize Firebase Admin with credentials
      try {
        // Check if Firebase app is already initialized to avoid multiple initializations
        const app = initializeApp({
          credential: cert(serviceAccount)
        }, `app-${appId}`); // Use a unique app name
        
        firestoreClient = getFirestore(app);
      } catch (error: any) {
        // If app already exists, get the existing app's Firestore
        console.log(`App may already be initialized: ${error.message}`);
        firestoreClient = getFirestore();
      }
      
      firestoreInitialized = true;
      console.log("Firestore initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Firestore:", error);
      throw new Error("Firestore initialization failed");
    }
  }
  return firestoreClient;
}

// Helper to get document reference
function getDocRef(appId: string, userId: string, channel: string): any {
  const collectionName = process.env.FIRESTORE_COLLECTION || "language_tutor";
  const docId = `${appId}_${channel}_${userId}`;
  return firestoreClient.collection(collectionName).doc(docId);
}

// Default words for new users
const DEFAULT_WORDS = [
  "cheese",
  "happy",
  "eat",
  "green",
  "Sunday"
];

// Implement the tool functions
async function get_word_list(appId: string, userId: string, channel: string, args: any): Promise<string> {
  try {
    await ensureFirestoreInit(appId);
    const docRef = getDocRef(appId, userId, channel);
    
    // Get the current document
    const doc = await docRef.get();
    
    let words: Record<string, any> = {};
    if (doc.exists) {
      const data = doc.data() || {};
      words = data[DOC_WORDS_PATH] || {};
      
      // Update TTL
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + DEFAULT_TTL);
      await docRef.update({ [DOC_EXPIRE_PATH]: expiration });
    } else {
      // Create new document with default words
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + DEFAULT_TTL);
      
      // All default words are "new"
      const newWords: Record<string, string> = {};
      DEFAULT_WORDS.forEach(word => {
        newWords[word] = "new";
      });
      
      await docRef.set({
        [DOC_EXPIRE_PATH]: expiration,
        [DOC_WORDS_PATH]: newWords
      });
      
      words = newWords;
    }
    
    return JSON.stringify({ words });
  } catch (error) {
    console.error("Error in get_word_list:", error);
    return JSON.stringify({ 
      error: "Failed to retrieve word list", 
      words: DEFAULT_WORDS.reduce((acc, word) => ({ ...acc, [word]: "new" }), {}) 
    });
  }
}

async function set_word_result(appId: string, userId: string, channel: string, args: any): Promise<string> {
  try {
    const word = args.word;
    const correct = args.correct;
    
    if (!word || correct === undefined) {
      return JSON.stringify({ 
        error: "Both 'word' (string) and 'correct' (boolean) are required." 
      });
    }
    
    await ensureFirestoreInit(appId);
    const docRef = getDocRef(appId, userId, channel);
    
    // Get current document
    const doc = await docRef.get();
    let data: Record<string, any> = {};
    
    if (doc.exists) {
      data = doc.data() || {};
    } else {
      // Create expiration date
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + DEFAULT_TTL);
      data[DOC_EXPIRE_PATH] = expiration;
    }
    
    // Initialize words object if it doesn't exist
    if (!data[DOC_WORDS_PATH]) {
      data[DOC_WORDS_PATH] = {};
    }
    
    // Update the word result
    data[DOC_WORDS_PATH][word] = correct;
    
    // Write back to Firestore
    await docRef.set(data);
    
    return JSON.stringify({
      status: "success",
      message: `Updated word "${word}" with result: ${correct ? "correct" : "incorrect"}`
    });
  } catch (error) {
    console.error("Error in set_word_result:", error);
    return JSON.stringify({ 
      error: "Failed to update word result"
    });
  }
}

// Create the tool map
const LANGUAGE_TUTOR_TOOL_MAP = {
  get_word_list,
  set_word_result
};

// Export the complete endpoint configuration
// This endpoint doesn't specify communication modes, so it will work exactly as before
// No RTM chat will be initialized, no mode context will be added to system messages
export const languageTutorEndpointConfig: EndpointConfig = {
  ragData: LANGUAGE_TUTOR_RAG_DATA,
  tools: LANGUAGE_TUTOR_TOOLS,
  toolMap: LANGUAGE_TUTOR_TOOL_MAP,
  systemMessageTemplate: languageTutorSystemTemplate
};