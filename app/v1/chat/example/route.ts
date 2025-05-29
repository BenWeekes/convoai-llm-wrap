// File: app/api/example/route.ts
// API route for the example endpoint with RTM chat integration

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { exampleEndpointConfig } from '@/lib/endpoints/example-endpoint';

// Create the handler with the endpoint name for RTM chat initialization
const handler = createEndpointHandler(exampleEndpointConfig, 'EXAMPLE');

// Export the handler for both GET and POST
export const GET = handler;
export const POST = handler;