// lib/common/order-utils.ts
// Utilities for order lookup - currently hardcoded for benweekes73@gmail.com

import { createLogger } from './logger';

const logger = createLogger('ORDER-LOOKUP');

/**
 * Validates email format
 *
 * @param email - Email address to validate
 * @returns true if valid format, false otherwise
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Basic email regex pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

/**
 * Looks up order information by email address
 * Currently returns hardcoded data for benweekes73@gmail.com
 *
 * @param email - Customer's email address
 * @returns Order information as formatted string
 */
export function lookupOrder(email: string): string {
  logger.info('Order lookup requested', { email });

  // Validate email format
  if (!validateEmail(email)) {
    logger.warn('Invalid email format', { email });
    return 'Invalid email format. Please provide a valid email address.';
  }

  // Normalize email to lowercase for comparison
  const normalizedEmail = email.toLowerCase().trim();

  // Check if this is the hardcoded test email
  if (normalizedEmail === 'benweekes73@gmail.com') {
    logger.info('Order found for test email', { email: normalizedEmail });

    return `Order #ORD-2025-12345
Status: Shipped
Date: November 1, 2025
Items:
  - Widget Pro (x2) - $49.99 each
  - Gadget Ultra (x1) - $79.99
Total: $179.97
Tracking: TRACK-ABC123456
Expected Delivery: November 12, 2025`;
  }

  // No order found for this email
  logger.info('No order found for email', { email: normalizedEmail });
  return 'No orders found for this email address. Please check your email and try again, or contact support for assistance.';
}
