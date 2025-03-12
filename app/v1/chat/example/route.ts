// File: app/v1/chat/example/route.ts
// Route handler for the example endpoint with sandwich and photo tools

import { createEndpointHandler } from '../../../../lib/common/endpoint-factory';
import { exampleEndpointConfig } from '../../../../lib/endpoints/example-endpoint';

export const runtime = 'nodejs';

// Create the endpoint handler using the example configuration
const handler = createEndpointHandler(exampleEndpointConfig);

// Export the POST method
export async function POST(req: Request) {
  return handler(req);
}
