// lib/endpoints/dripshop-endpoint.ts
// Configuration for the dripshop endpoint - Pure API endpoint without RTM chat support
// Based on groupcall but simplified for API-only usage

import OpenAI from 'openai';
import type { EndpointConfig } from '../types';

// Define RAG data for this endpoint
const DRIPSHOP_RAG_DATA = {
  doc1: "This is a dripshop system for managing fashion and clothing interactions.",
  doc2: "Multiple users can interact with the fashion assistant simultaneously.",
  doc3: "The assistant can help with outfit recommendations, style advice, and fashion trends.",
  doc4: "The system supports group interactions for collaborative shopping experiences."
};

// Define the system message template for dripshop
function dripshopSystemTemplate(ragData: Record<string, string>): string {
  // Since this is a pure API endpoint, we don't need RTM-specific prompts
  const basePrompt = 'You are a helpful fashion and style assistant specializing in streetwear and modern fashion trends.';

  return `
    ${basePrompt}

    DRIPSHOP ASSISTANT BEHAVIOR:
    - You are a knowledgeable fashion consultant with expertise in streetwear, designer brands, and current trends
    - Help users with outfit recommendations, style advice, and fashion coordination
    - Consider factors like occasion, weather, personal style, and budget when making recommendations
    - Be enthusiastic about fashion while remaining inclusive and body-positive
    - Support group shopping experiences where multiple users can collaborate on outfit choices
    
    GROUP INTERACTION GUIDELINES:
    - When multiple users are involved, help coordinate group outfits or themed looks
    - Facilitate discussions about fashion choices between users
    - Offer comparative advice when users have different style preferences
    - Keep responses engaging and fashion-forward while being practical
    
    FASHION EXPERTISE:
    - Stay current with fashion trends and seasonal styles
    - Understand color theory and pattern mixing
    - Know about different clothing materials and their care
    - Be aware of various fashion subcultures and aesthetic styles
    - Provide sizing and fit advice when relevant
    
    You have access to the following knowledge:
    doc1: "${ragData.doc1}"
    doc2: "${ragData.doc2}"
    doc3: "${ragData.doc3}"
    doc4: "${ragData.doc4}"
  `;
}

// Define tools for the dripshop endpoint (you can add fashion-specific tools later)
const DRIPSHOP_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_outfit",
      description: "Search for outfit recommendations based on style preferences and occasion",
      parameters: {
        type: "object",
        properties: {
          style: {
            type: "string",
            description: "Style preference (e.g., 'streetwear', 'formal', 'casual', 'athleisure')"
          },
          occasion: {
            type: "string",
            description: "The occasion for the outfit (e.g., 'party', 'work', 'date', 'gym')"
          },
          budget: {
            type: "string",
            description: "Budget range (e.g., 'low', 'medium', 'high', 'luxury')"
          }
        },
        required: ["style"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_trend_report",
      description: "Get current fashion trend information for a specific category or season",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Fashion category (e.g., 'sneakers', 'outerwear', 'accessories', 'all')"
          },
          season: {
            type: "string",
            description: "Season to check trends for (e.g., 'current', 'spring', 'summer', 'fall', 'winter')"
          }
        },
        required: []
      }
    }
  }
];

// Implement the tool functions
async function search_outfit(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const style = args?.style || "casual";
  const occasion = args?.occasion || "everyday";
  const budget = args?.budget || "medium";
  
  console.log(`👔 [DRIPSHOP] Searching outfit for ${userId}:`, { style, occasion, budget, channel });
  
  // Simulated outfit recommendations - you can replace with actual API calls
  const outfitSuggestions = {
    streetwear: {
      party: "Oversized graphic tee, cargo pants, Jordan 4s, chain accessories",
      work: "Minimalist hoodie, tailored joggers, clean white sneakers, crossbody bag",
      date: "Designer polo, slim-fit jeans, luxury sneakers, subtle jewelry"
    },
    formal: {
      party: "Slim-fit blazer, dress shirt, tailored trousers, oxford shoes",
      work: "Business suit, crisp white shirt, silk tie, leather dress shoes",
      date: "Smart casual blazer, dark jeans, chelsea boots, watch"
    },
    casual: {
      party: "Band tee, ripped jeans, Vans, denim jacket",
      work: "Button-up shirt, chinos, loafers, leather belt",
      date: "Henley shirt, dark jeans, clean sneakers, bomber jacket"
    }
  };
  
  const styleOutfits = outfitSuggestions[style as keyof typeof outfitSuggestions] || outfitSuggestions.casual;
  const outfit = styleOutfits[occasion as keyof typeof styleOutfits] || styleOutfits.date;
  
  const budgetNote = budget === "luxury" ? "Premium brands recommended" : 
                     budget === "high" ? "Mix of designer and quality brands" :
                     budget === "medium" ? "Good quality affordable brands" :
                     "Budget-friendly alternatives available";
  
  return `Found the perfect ${style} outfit for ${occasion}:\n\n${outfit}\n\nBudget consideration: ${budgetNote}`;
}

async function get_trend_report(appId: string, userId: string, channel: string, args: any): Promise<string> {
  const category = args?.category || "all";
  const season = args?.season || "current";
  
  console.log(`📊 [DRIPSHOP] Getting trend report for ${userId}:`, { category, season, channel });
  
  // Simulated trend data - replace with actual trend API or database
  const trends = {
    sneakers: "Retro runners and chunky soles are dominating. New Balance 550s and ASICS collabs are hot.",
    outerwear: "Oversized puffers and vintage leather jackets. Technical fabrics with streetwear aesthetics.",
    accessories: "Minimalist jewelry, bucket hats, and crossbody bags. Sustainable materials trending.",
    all: "Y2K revival continues strong. Earth tones and neutrals dominate. Comfort-first luxury is key."
  };
  
  const trendInfo = trends[category as keyof typeof trends] || trends.all;
  
  return `${season.charAt(0).toUpperCase() + season.slice(1)} trend report for ${category}:\n\n${trendInfo}\n\nStay ahead of the curve! 🔥`;
}

// Create the tool map
const DRIPSHOP_TOOL_MAP = {
  search_outfit: async (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 [DRIPSHOP] Tool map: search_outfit called for channel: ${channel}`);
    try {
      const result = await search_outfit(appId, userId, channel, args);
      console.log(`🔧 [DRIPSHOP] Tool map: search_outfit completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 [DRIPSHOP] Tool map: search_outfit error:`, error);
      throw error;
    }
  },
  get_trend_report: async (appId: string, userId: string, channel: string, args: any) => {
    console.log(`🔧 [DRIPSHOP] Tool map: get_trend_report called for channel: ${channel}`);
    try {
      const result = await get_trend_report(appId, userId, channel, args);
      console.log(`🔧 [DRIPSHOP] Tool map: get_trend_report completed successfully`);
      return result;
    } catch (error) {
      console.error(`🔧 [DRIPSHOP] Tool map: get_trend_report error:`, error);
      throw error;
    }
  }
};

// Debug logging at module load time
console.log('🔧 [DRIPSHOP] Dripshop endpoint configured as pure API endpoint (no RTM chat)');
console.log('📝 [DRIPSHOP] User ID prefixing enabled for group fashion consultations');
console.log('🛍️ [DRIPSHOP] Available tools:', Object.keys(DRIPSHOP_TOOL_MAP));

// Export the complete endpoint configuration
export const dripshopEndpointConfig: EndpointConfig = {
  ragData: DRIPSHOP_RAG_DATA,
  tools: DRIPSHOP_TOOLS,
  toolMap: DRIPSHOP_TOOL_MAP,
  systemMessageTemplate: dripshopSystemTemplate,
  communicationModes: {
    supportsChat: false,              // ❌ No RTM chat support - pure API endpoint
    endpointMode: 'video',           // Video calling for fashion consultations
    prependUserId: true,             // ✅ Enable user ID prefixing for group interactions
    prependCommunicationMode: false  // ❌ No mode prefixing needed for pure API
  }
};