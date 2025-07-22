// app/v1/chat/groupcall/route.ts
// API route for the group call endpoint with RTM chat integration

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { groupCallEndpointConfig } from '@/lib/endpoints/groupcall-endpoint';

// Create the handler with the endpoint name for RTM chat initialization
const handler = createEndpointHandler(groupCallEndpointConfig, 'GROUPCALL');

// Export the handler for both GET and POST
export const GET = handler;
export const POST = handler;
