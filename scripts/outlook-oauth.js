/**
 * Outlook OAuth Flow Script
 *
 * This script helps you get OAuth tokens for a tenant's Outlook account.
 *
 * Prerequisites:
 * 1. Create an Azure App Registration at https://portal.azure.com
 * 2. Add redirect URI: http://localhost:3333/callback
 * 3. Add API permissions: Microsoft Graph > Mail.Read (delegated)
 * 4. Create a client secret
 * 5. Set environment variables:
 *    - OUTLOOK_CLIENT_ID
 *    - OUTLOOK_CLIENT_SECRET
 *
 * Usage:
 *   node scripts/outlook-oauth.js <tenant_id>
 *
 * Example:
 *   node scripts/outlook-oauth.js tenant_mom
 */

const http = require('http');
const { URL } = require('url');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPES = 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access openid profile';

// Encryption functions (matching src/utils/encryption.ts)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SCRYPT_SALT = 'proxystaff-credential-encryption-v1';

function getEncryptionKey() {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters');
  }
  return crypto.scryptSync(key, SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 });
}

function encryptCredential(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

async function main() {
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error('Usage: node scripts/outlook-oauth.js <tenant_id>');
    console.error('Example: node scripts/outlook-oauth.js tenant_mom');
    process.exit(1);
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Error: OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET must be set in .env');
    console.error('\nTo set up:');
    console.error('1. Go to https://portal.azure.com');
    console.error('2. Navigate to Azure Active Directory > App registrations');
    console.error('3. Click "New registration"');
    console.error('4. Name: "ProxyStaff Email" (or similar)');
    console.error('5. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"');
    console.error('6. Redirect URI: Web > http://localhost:3333/callback');
    console.error('7. After creation, go to "Certificates & secrets" > New client secret');
    console.error('8. Go to "API permissions" > Add permission > Microsoft Graph > Delegated > Mail.Read');
    console.error('9. Add OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET to your .env file');
    process.exit(1);
  }

  // Build auth URL
  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('response_mode', 'query');

  console.log('\n=== Outlook OAuth Setup ===\n');
  console.log(`Setting up Outlook for tenant: ${tenantId}\n`);
  console.log('1. Open this URL in your browser:\n');
  console.log(`   ${authUrl.toString()}\n`);
  console.log('2. Sign in with the Outlook account you want to connect');
  console.log('3. Grant the requested permissions\n');
  console.log('Waiting for callback...\n');

  // Start local server to receive callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:3333`);

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error</h1><p>${error}: ${url.searchParams.get('error_description')}</p>`);
        console.error('OAuth error:', error);
        server.close();
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Error</h1><p>No authorization code received</p>');
        server.close();
        process.exit(1);
      }

      try {
        // Exchange code for tokens
        console.log('Received authorization code, exchanging for tokens...');

        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: REDIRECT_URI,
            scope: SCOPES,
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Token exchange failed: ${errorText}`);
        }

        const tokens = await tokenResponse.json();

        // Calculate expiry date
        const expiryDate = Date.now() + (tokens.expires_in * 1000);

        // Store in database
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        const adapter = new PrismaPg(pool);
        const prisma = new PrismaClient({ adapter });

        const oauthData = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: expiryDate,
        };

        await prisma.tenant_credentials.upsert({
          where: {
            tenant_id_service_name: {
              tenant_id: tenantId,
              service_name: 'outlook_oauth',
            },
          },
          create: {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            service_name: 'outlook_oauth',
            encrypted_value: encryptCredential(JSON.stringify(oauthData)),
            updated_at: new Date(),
          },
          update: {
            encrypted_value: encryptCredential(JSON.stringify(oauthData)),
            updated_at: new Date(),
          },
        });

        await prisma.$disconnect();

        console.log('Successfully stored Outlook OAuth credentials!');
        console.log(`Tenant: ${tenantId}`);
        console.log(`Token expires: ${new Date(expiryDate).toISOString()}`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Success!</h1>
              <p>Outlook account connected for tenant: <strong>${tenantId}</strong></p>
              <p>You can close this window now.</p>
            </body>
          </html>
        `);

        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1000);

      } catch (err) {
        console.error('Error exchanging code for tokens:', err);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error</h1><p>${err.message}</p>`);
        server.close();
        process.exit(1);
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(3333, () => {
    console.log('OAuth callback server listening on http://localhost:3333');
  });
}

main().catch(console.error);
