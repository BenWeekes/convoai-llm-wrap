// File: app/v1/chat/languagetutor/route.ts
// Route handler for the language tutor endpoint

import { createEndpointHandler } from '../../../../lib/common/endpoint-factory';
import { languageTutorEndpointConfig } from '../../../../lib/endpoints/language-tutor-endpoint';

export const runtime = 'nodejs';

// Create the endpoint handler using the language tutor configuration
const handler = createEndpointHandler(languageTutorEndpointConfig);

// Export the POST method
export async function POST(req: Request) {
  return handler(req);
}
