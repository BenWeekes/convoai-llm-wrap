// app/v1/chat/support/route.ts
// Route handler for customer support endpoint with human handoff and order lookup

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { supportEndpointConfig } from '@/lib/endpoints/support-endpoint';

// Create the handler using the factory pattern
const handler = createEndpointHandler(supportEndpointConfig, 'SUPPORT');

// Export GET and POST handlers
export const GET = handler;
export const POST = handler;
