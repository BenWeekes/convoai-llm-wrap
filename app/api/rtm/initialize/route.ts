// app/api/rtm/initialize/route.ts
// Updated to remove legacy RTM service - only shows modern endpoint-based RTM status

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/common/logger';

const logger = createLogger('RTM-INIT');

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
    dripshop: {
      configured: false, // Dripshop doesn't use RTM (pure API endpoint)
      app_id: false,
      from_user: false,
      channel: false,
      llm_configured: false,
      note: 'Dripshop is a pure API endpoint without RTM chat support'
    }
  };

  logger.info('Endpoint RTM Configuration Status', endpointStatus);

  return NextResponse.json({ 
    success: true, 
    message: 'Using modern endpoint-based RTM system',
    info: 'RTM is initialized per-endpoint when first accessed',
    endpoints: endpointStatus,
    legacy_rtm_removed: true,
    recommendation: 'Each endpoint manages its own RTM configuration independently'
  });
}