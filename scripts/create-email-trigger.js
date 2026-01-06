/**
 * Create Email Trigger for a Tenant
 *
 * Usage:
 *   node scripts/create-email-trigger.js <tenant_id> <source> [phone]
 *
 * Examples:
 *   node scripts/create-email-trigger.js tenant_mom outlook +18015546207
 *   node scripts/create-email-trigger.js tenant_mom email +18015546207
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
const crypto = require('crypto');
require('dotenv').config();

async function main() {
  const tenantId = process.argv[2];
  const source = process.argv[3] || 'outlook'; // 'outlook' or 'email' (gmail)
  const phone = process.argv[4];

  if (!tenantId) {
    console.error('Usage: node scripts/create-email-trigger.js <tenant_id> <source> [phone]');
    console.error('Example: node scripts/create-email-trigger.js tenant_mom outlook +18015546207');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Get tenant info
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      console.error(`Tenant not found: ${tenantId}`);
      process.exit(1);
    }

    const userPhone = phone || tenant.phone_number;

    // Create the email trigger
    const trigger = await prisma.triggers.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        user_phone: userPhone,
        name: `Email Summary - ${source === 'outlook' ? 'Outlook' : 'Gmail'}`,
        description: 'Summarize incoming emails and suggest actions',
        trigger_type: 'EVENT',
        status: 'ACTIVE',
        autonomy: 'NOTIFY', // Will notify and wait for confirmation
        config: {
          event_source: source, // 'outlook' or 'email' (gmail)
          event_type: 'new_email',
          filters: {}, // No filters = all unread emails
          debounce_seconds: 300, // 5 minute polling interval
        },
        task_prompt: `You received a new email. Please:

1. **Summarize** the email in 2-3 sentences
2. **Note** anything important or interesting the recipient might like
3. **Recommend** one of these actions:
   - **UNSUBSCRIBE**: If it's a newsletter/promotional email they probably don't want
   - **READ**: If it contains useful info but doesn't need a response
   - **DELETE**: If it's spam, outdated, or irrelevant
   - **RESPOND**: If it requires a reply (draft a suggested response)

Format your response like:
📧 **From:** [sender name]
📝 **Summary:** [brief summary]
💡 **Note:** [anything they'd find interesting]
✅ **Action:** [UNSUBSCRIBE/READ/DELETE/RESPOND]
[If RESPOND, include suggested reply]

Email details:
- From: {{payload.data.from}} ({{payload.data.fromName}})
- Subject: {{payload.data.subject}}
- Received: {{payload.data.receivedAt}}
- Preview: {{payload.data.snippet}}
- Body: {{payload.data.body}}`,
        cooldown_seconds: 0, // No cooldown between emails
      },
    });

    console.log('Created email trigger:');
    console.log(`  ID: ${trigger.id}`);
    console.log(`  Name: ${trigger.name}`);
    console.log(`  Tenant: ${tenantId}`);
    console.log(`  Phone: ${userPhone}`);
    console.log(`  Source: ${source}`);
    console.log(`  Status: ${trigger.status}`);
    console.log('\nThe trigger will check for new emails every 5 minutes.');
    console.log('Make sure OAuth is set up for this email source!');

  } catch (error) {
    console.error('Error creating trigger:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
