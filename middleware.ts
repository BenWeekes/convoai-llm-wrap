// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Log middleware activity
  console.log('[MIDDLEWARE] Processing request for:', pathname);
  
  // Allow all requests to proceed normally
  // The modern endpoint-based RTM system handles its own initialization
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files and images
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};