// app/v1/chat/dripshop/route.ts
// API route for the dripshop endpoint - Pure API without RTM chat integration

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { dripshopEndpointConfig } from '@/lib/endpoints/dripshop-endpoint';

// Create the handler with endpoint name for logging purposes
// Even though dripshop doesn't support RTM chat, we still pass the name for better logging
// The endpoint configuration (supportsChat: false) will prevent RTM initialization
const handler = createEndpointHandler(dripshopEndpointConfig, 'DRIPSHOP');

// Export the handler for both GET and POST
export const GET = handler;
export const POST = handler;