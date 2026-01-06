/**
 * Internal Outlook API Routes
 *
 * These endpoints are called by Python tools to interact with Outlook.
 * The server handles all OAuth token management.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrismaClient } from '../services/prisma.js';
import { decryptCredential, encryptCredential } from '../utils/encryption.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface OutlookTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

/**
 * Get a valid access token for a tenant, refreshing if needed.
 */
async function getAccessToken(tenantId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const config = getConfig();

  const credentials = await prisma.tenant_credentials.findUnique({
    where: {
      tenant_id_service_name: {
        tenant_id: tenantId,
        service_name: 'outlook_oauth',
      },
    },
  });

  if (!credentials) {
    logger.warn({ tenantId }, 'No Outlook OAuth credentials found');
    return null;
  }

  const oauthData = JSON.parse(decryptCredential(credentials.encrypted_value)) as OutlookTokens;

  // Check if token needs refresh (1 minute before expiry)
  if (Date.now() > oauthData.expiry_date - 60000) {
    if (!config.outlook) {
      logger.error('Outlook OAuth not configured');
      return null;
    }

    try {
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: oauthData.refresh_token,
          client_id: config.outlook.clientId,
          client_secret: config.outlook.clientSecret,
          scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access',
        }),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Failed to refresh Outlook token');
        return null;
      }

      const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
      const newExpiryDate = Date.now() + data.expires_in * 1000;

      // Update stored credentials
      await prisma.tenant_credentials.update({
        where: {
          tenant_id_service_name: {
            tenant_id: tenantId,
            service_name: 'outlook_oauth',
          },
        },
        data: {
          encrypted_value: encryptCredential(JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token || oauthData.refresh_token,
            expiry_date: newExpiryDate,
          })),
          updated_at: new Date(),
        },
      });

      return data.access_token;
    } catch (error) {
      logger.error({ tenantId, error }, 'Error refreshing Outlook token');
      return null;
    }
  }

  return oauthData.access_token;
}

export async function outlookRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Search emails
   * POST /api/internal/outlook/search
   */
  server.post('/api/internal/outlook/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant_id, query, folder = 'inbox', limit = 10 } = request.body as {
      tenant_id: string;
      query?: string;
      folder?: string;
      limit?: number;
    };

    if (!tenant_id) {
      return reply.status(400).send({ success: false, error: 'tenant_id required' });
    }

    const accessToken = await getAccessToken(tenant_id);
    if (!accessToken) {
      return reply.status(401).send({ success: false, error: 'No valid Outlook credentials' });
    }

    try {
      // Build OData query
      let url = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead`;

      if (query) {
        url += `&$search="${encodeURIComponent(query)}"`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Outlook search failed');
        return reply.status(response.status).send({ success: false, error: 'Search failed' });
      }

      const data = await response.json() as { value: unknown[] };

      return reply.send({
        success: true,
        emails: data.value,
        count: data.value.length,
      });
    } catch (error) {
      logger.error({ error }, 'Error searching Outlook emails');
      return reply.status(500).send({ success: false, error: 'Internal error' });
    }
  });

  /**
   * Send email
   * POST /api/internal/outlook/send
   */
  server.post('/api/internal/outlook/send', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant_id, to, subject, body, reply_to_id } = request.body as {
      tenant_id: string;
      to: string | string[];
      subject: string;
      body: string;
      reply_to_id?: string;
    };

    if (!tenant_id || !to || !subject || !body) {
      return reply.status(400).send({ success: false, error: 'tenant_id, to, subject, and body required' });
    }

    const accessToken = await getAccessToken(tenant_id);
    if (!accessToken) {
      return reply.status(401).send({ success: false, error: 'No valid Outlook credentials' });
    }

    try {
      let url: string;
      let method: string;
      let requestBody: unknown;

      if (reply_to_id) {
        // Reply to existing message
        url = `https://graph.microsoft.com/v1.0/me/messages/${reply_to_id}/reply`;
        method = 'POST';
        requestBody = {
          comment: body,
        };
      } else {
        // Send new message
        url = 'https://graph.microsoft.com/v1.0/me/sendMail';
        method = 'POST';
        requestBody = {
          message: {
            subject,
            body: {
              contentType: 'Text',
              content: body,
            },
            toRecipients: Array.isArray(to)
              ? to.map((email: string) => ({ emailAddress: { address: email } }))
              : [{ emailAddress: { address: to } }],
          },
        };
      }

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Outlook send failed');
        return reply.status(response.status).send({ success: false, error: 'Send failed' });
      }

      return reply.send({ success: true, message: 'Email sent successfully' });
    } catch (error) {
      logger.error({ error }, 'Error sending Outlook email');
      return reply.status(500).send({ success: false, error: 'Internal error' });
    }
  });

  /**
   * Delete email
   * POST /api/internal/outlook/delete
   */
  server.post('/api/internal/outlook/delete', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant_id, message_id } = request.body as {
      tenant_id: string;
      message_id: string;
    };

    if (!tenant_id || !message_id) {
      return reply.status(400).send({ success: false, error: 'tenant_id and message_id required' });
    }

    const accessToken = await getAccessToken(tenant_id);
    if (!accessToken) {
      return reply.status(401).send({ success: false, error: 'No valid Outlook credentials' });
    }

    try {
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${message_id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok && response.status !== 204) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Outlook delete failed');
        return reply.status(response.status).send({ success: false, error: 'Delete failed' });
      }

      return reply.send({ success: true, message: 'Email deleted' });
    } catch (error) {
      logger.error({ error }, 'Error deleting Outlook email');
      return reply.status(500).send({ success: false, error: 'Internal error' });
    }
  });

  /**
   * Mark email as read
   * POST /api/internal/outlook/mark-read
   */
  server.post('/api/internal/outlook/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant_id, message_id } = request.body as {
      tenant_id: string;
      message_id: string;
    };

    if (!tenant_id || !message_id) {
      return reply.status(400).send({ success: false, error: 'tenant_id and message_id required' });
    }

    const accessToken = await getAccessToken(tenant_id);
    if (!accessToken) {
      return reply.status(401).send({ success: false, error: 'No valid Outlook credentials' });
    }

    try {
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${message_id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead: true }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Outlook mark-read failed');
        return reply.status(response.status).send({ success: false, error: 'Mark read failed' });
      }

      return reply.send({ success: true, message: 'Email marked as read' });
    } catch (error) {
      logger.error({ error }, 'Error marking Outlook email as read');
      return reply.status(500).send({ success: false, error: 'Internal error' });
    }
  });

  /**
   * Get full email content
   * POST /api/internal/outlook/get
   */
  server.post('/api/internal/outlook/get', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant_id, message_id } = request.body as {
      tenant_id: string;
      message_id: string;
    };

    if (!tenant_id || !message_id) {
      return reply.status(400).send({ success: false, error: 'tenant_id and message_id required' });
    }

    const accessToken = await getAccessToken(tenant_id);
    if (!accessToken) {
      return reply.status(401).send({ success: false, error: 'No valid Outlook credentials' });
    }

    try {
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${message_id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Outlook get failed');
        return reply.status(response.status).send({ success: false, error: 'Get failed' });
      }

      const email = await response.json();
      return reply.send({ success: true, email });
    } catch (error) {
      logger.error({ error }, 'Error getting Outlook email');
      return reply.status(500).send({ success: false, error: 'Internal error' });
    }
  });
}
