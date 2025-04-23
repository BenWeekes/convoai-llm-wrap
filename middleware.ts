// middleware.ts

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Track initialization
let initializationStarted = false;

export async function middleware(request: NextRequest) {
  // Only run initialization once
  if (!initializationStarted) {
    initializationStarted = true;
    
    // Trigger the initialization API
    try {
      console.log('[MIDDLEWARE] Starting RTM initialization...');
      
      // Fetch the initialization endpoint
      const baseUrl = process.env.NEXTAUTH_URL || 
                      process.env.VERCEL_URL || 
                      `http://localhost:${process.env.PORT || 3040}`;
      
      const response = await fetch(`${baseUrl}/api/rtm/initialize`);
      const data = await response.json();
      
      console.log('[MIDDLEWARE] RTM initialization result:', data);
    } catch (error) {
      console.error('[MIDDLEWARE] Failed to initialize RTM:', error);
    }
  }
  
  return NextResponse.next();
}
