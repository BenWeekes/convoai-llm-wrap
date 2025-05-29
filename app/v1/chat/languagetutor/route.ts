// File: app/api/language-tutor/route.ts
// API route for the language tutor endpoint (voice only for now)

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { languageTutorEndpointConfig } from '@/lib/endpoints/language-tutor-endpoint';

// Create the handler without RTM chat integration (pass undefined for endpointName)
const handler = createEndpointHandler(languageTutorEndpointConfig);

// Export the handler for both GET and POST
export const GET = handler;
export const POST = handler;