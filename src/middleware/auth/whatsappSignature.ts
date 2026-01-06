import { createHmac, timingSafeEqual } from 'crypto';
import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { getConfig } from '../../config/index.js';
import { AppError } from '../errorHandler.js';

/**
 * WhatsApp HMAC-SHA256 signature verification middleware
 * Validates X-Hub-Signature-256 header using WHATSAPP_APP_SECRET
 */
export const verifyWhatsAppSignature: preHandlerHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply
) => {
  const signatureHeader = request.headers['x-hub-signature-256'];

  if (!signatureHeader || typeof signatureHeader !== 'string') {
    throw new AppError('Missing X-Hub-Signature-256 header', 'MISSING_SIGNATURE', 401);
  }

  // Get the raw body stored by the content type parser
  const rawBody = request.rawBody;

  if (!rawBody) {
    throw new AppError('Unable to access raw request body', 'BODY_ACCESS_ERROR', 500);
  }

  const config = getConfig();
  const appSecret = config.whatsapp.appSecret;

  // Compute expected signature
  const hmac = createHmac('sha256', appSecret);
  hmac.update(rawBody);
  const expectedSignature = 'sha256=' + hmac.digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  // If lengths differ, signatures don't match (but still do timing-safe compare with padded buffer)
  if (signatureBuffer.length !== expectedBuffer.length) {
    throw new AppError('Invalid signature', 'INVALID_SIGNATURE', 401);
  }

  const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!isValid) {
    throw new AppError('Invalid signature', 'INVALID_SIGNATURE', 401);
  }

  // Signature is valid, continue to handler
};
