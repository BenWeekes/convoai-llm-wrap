// app/api/rtm/initialize/route.ts

import { NextResponse } from 'next/server';

export async function GET() {
  // This route is kept for backwards compatibility but returns info about the modern setup
  
  const endpointStatus = {
    example: {
      configured: !!(process.env.EXAMPLE_RTM_APP_ID && process.env.EXAMPLE_RTM_FROM_USER && process.env.EXAMPLE_RTM_CHANNEL),
      app_id: !!process.env.EXAMPLE_RTM_APP_ID,
      from_user: !!process.env.EXAMPLE_RTM_FROM_USER,
      channel: !!process.env.EXAMPLE_RTM_CHANNEL,
      llm_configured: !!process.env.EXAMPLE_RTM_LLM_API_KEY
    },
    groupcall: {
      configured: !!(process.env.GROUPCALL_RTM_APP_ID && process.env.GROUPCALL_RTM_FROM_USER && process.env.GROUPCALL_RTM_CHANNEL),
      app_id: !!process.env.GROUPCALL_RTM_APP_ID,
      from_user: !!process.env.GROUPCALL_RTM_FROM_USER,
      channel: !!process.env.GROUPCALL_RTM_CHANNEL,
      llm_configured: !!process.env.GROUPCALL_RTM_LLM_API_KEY
    },
    legacy: {
      configured: !!(process.env.RTM_APP_ID && process.env.RTM_FROM_USER),
      app_id: !!process.env.RTM_APP_ID,
      from_user: !!process.env.RTM_FROM_USER,
      channel: !!process.env.RTM_CHANNEL
    }
  };

  console.log('[RTM] Endpoint RTM Configuration Status:', endpointStatus);

  return NextResponse.json({ 
    success: true, 
    message: 'Using modern endpoint-based RTM system',
    info: 'RTM is initialized per-endpoint when first accessed',
    endpoints: endpointStatus,
    recommendation: endpointStatus.legacy.configured ? 
      'Legacy RTM variables detected but not used' : 
      'No legacy RTM configuration (this is expected)'
  });
}