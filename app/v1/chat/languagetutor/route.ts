// File: app/api/language-tutor/route.ts
// API route for the language tutor endpoint (voice only for now)

import { createEndpointHandler } from '@/lib/common/endpoint-factory';
import { languageTutorEndpointConfig } from '@/lib/endpoints/language-tutor-endpoint';

// Create the handler with endpoint name for logging purposes
// Even though it doesn't support RTM chat, we still pass the name for better logging
const handler = createEndpointHandler(languageTutorEndpointConfig, 'LANGUAGETUTOR');

// Export the handler for both GET and POST
export const GET = handler;
export const POST = handler;