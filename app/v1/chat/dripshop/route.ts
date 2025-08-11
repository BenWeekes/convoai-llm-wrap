// app/v1/chat/dripshop/route.ts
// API route for the dripshop endpoint - Pure API without RTM chat integration

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { dripshopEndpointConfig } from '@/lib/endpoints/dripshop-endpoint';

// Create the handler WITHOUT endpoint name - this prevents RTM initialization
// Since we pass undefined as the second parameter, no RTM chat will be initialized
const handler = createEndpointHandler(dripshopEndpointConfig);

// Export the handler for both GET and POST
export const GET = handler;
export const POST = handler;