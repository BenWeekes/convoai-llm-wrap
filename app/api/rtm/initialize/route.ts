// app/api/rtm/initialize/route.ts

import { NextResponse } from 'next/server';
import RTMService from '../../../../lib/services/rtm-service';

export async function GET() {
  try {
    if (RTMService.isInitialized()) {
      return NextResponse.json({ 
        success: true, 
        message: 'RTM service already initialized' 
      });
    }
    
    const success = await RTMService.initialize();
    
    if (success) {
      return NextResponse.json({ 
        success: true, 
        message: 'RTM service initialized successfully' 
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: 'RTM service initialization failed' 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error initializing RTM service:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}
