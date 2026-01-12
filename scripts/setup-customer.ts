#!/usr/bin/env npx tsx
/**
 * Unified Customer Setup Script
 *
 * Creates a new tenant with a single command:
 * - Creates database record
 * - Initializes folder from template
 * - Sets credentials (if provided)
 * - Runs validation
 *
 * Usage:
 *   npx tsx scripts/setup-customer.ts --name "Business Name" --phone "+18015551234" [--channel telegram|whatsapp]
 *   npx tsx scripts/setup-customer.ts --from-file ./customers/intake.json
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, MessagingChannel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { randomUUID } from 'crypto';

// Project paths
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
const TEMPLATE_DIR = path.join(TENANTS_DIR, '_template');

// Parse command line arguments
function parseArgs(): {
  name?: string;
  phone?: string;
  channel?: MessagingChannel;
  fromFile?: string;
  credentials?: Record<string, string>;
} {
  const args: Record<string, string> = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = process.argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      }
    }
  }

  return {
    name: args['name'],
    phone: args['phone'],
    channel: (args['channel']?.toUpperCase() as MessagingChannel) || 'TELEGRAM',
    fromFile: args['from-file'],
  };
}

// Load configuration from JSON file
interface CustomerConfig {
  name: string;
  phone: string;
  channel?: 'WHATSAPP' | 'TELEGRAM';
  credentials?: Record<string, string>;
  business?: {
    industry?: string;
    location?: { city: string; state: string };
    hours?: { timezone: string; schedule: string };
    owner?: { name: string; role: string };
  };
  voice?: {
    tone?: string;
    style?: string;
  };
}

function loadFromFile(filePath: string): CustomerConfig {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content);
}

// Copy template directory recursively
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    let destName = entry.name;

    // Rename .env.example to .env
    if (entry.name === '.env.example') {
      destName = '.env';
    }

    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Write credentials to .env file
function writeCredentials(tenantPath: string, credentials: Record<string, string>): void {
  const envPath = path.join(tenantPath, '.env');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  for (const [key, value] of Object.entries(credentials)) {
    // Check if key already exists
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      // Replace existing value
      content = content.replace(regex, `${key}="${value}"`);
    } else {
      // Append new key
      content += `\n${key}="${value}"`;
    }
  }

  fs.writeFileSync(envPath, content.trim() + '\n');
}

// Validate phone number format
function validatePhone(phone: string): boolean {
  // Must start with + and contain only digits after
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

async function main(): Promise<void> {
  console.log('ProxyStaff Customer Setup\n');

  const args = parseArgs();
  let config: CustomerConfig;

  // Load config from file or command line
  if (args.fromFile) {
    console.log(`Loading config from: ${args.fromFile}`);
    config = loadFromFile(args.fromFile);
  } else if (args.name && args.phone) {
    config = {
      name: args.name,
      phone: args.phone,
      channel: args.channel || 'TELEGRAM',
    };
  } else {
    console.error('Error: Either --from-file or both --name and --phone are required');
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx scripts/setup-customer.ts --name "Business Name" --phone "+18015551234" [--channel telegram]');
    console.error('  npx tsx scripts/setup-customer.ts --from-file ./customers/intake.json');
    process.exit(1);
  }

  // Validate required fields
  if (!config.name || config.name.trim() === '') {
    console.error('Error: Business name is required');
    process.exit(1);
  }

  if (!config.phone || !validatePhone(config.phone)) {
    console.error('Error: Valid phone number required (format: +18015551234)');
    process.exit(1);
  }

  const channel = config.channel || 'TELEGRAM';
  const tenantId = randomUUID();
  const tenantPath = path.join(TENANTS_DIR, tenantId);

  console.log(`Setting up: ${config.name}`);
  console.log(`  Phone: ${config.phone}`);
  console.log(`  Channel: ${channel}`);
  console.log(`  ID: ${tenantId}`);
  console.log('');

  // Connect to database
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Step 1: Check for existing tenant with same phone
    console.log('Step 1: Checking for existing tenant...');
    const existing = await prisma.tenant.findFirst({
      where: { phone_number: config.phone },
    });

    if (existing) {
      console.error(`Error: Tenant with phone ${config.phone} already exists (ID: ${existing.id})`);
      process.exit(1);
    }
    console.log('  No existing tenant found');

    // Step 2: Create database record
    console.log('Step 2: Creating database record...');
    const tenant = await prisma.tenant.create({
      data: {
        id: tenantId,
        name: config.name,
        phone_number: config.phone,
        messaging_channel: channel,
        status: 'TRIAL',
        onboarding_status: 'DISCOVERY',
        updated_at: new Date(),
      },
    });
    console.log(`  Created tenant: ${tenant.id}`);

    // Step 3: Initialize folder from template
    console.log('Step 3: Initializing tenant folder...');
    if (!fs.existsSync(TEMPLATE_DIR)) {
      throw new Error(`Template folder not found: ${TEMPLATE_DIR}`);
    }
    copyDirRecursive(TEMPLATE_DIR, tenantPath);
    console.log(`  Created folder: ${tenantPath}`);

    // Step 4: Write credentials if provided
    if (config.credentials && Object.keys(config.credentials).length > 0) {
      console.log('Step 4: Writing credentials...');
      writeCredentials(tenantPath, config.credentials);
      console.log(`  Wrote ${Object.keys(config.credentials).length} credential(s)`);
    } else {
      console.log('Step 4: No credentials provided (skipping)');
    }

    // Step 5: Customize template files if business info provided
    if (config.business || config.voice) {
      console.log('Step 5: Customizing template files...');

      // Update directives/README.md with business name
      const readmePath = path.join(tenantPath, 'directives', 'README.md');
      if (fs.existsSync(readmePath)) {
        let readme = fs.readFileSync(readmePath, 'utf-8');
        readme = readme.replace('[TENANT_NAME]', config.name);
        fs.writeFileSync(readmePath, readme);
        console.log('  Updated directives/README.md');
      }

      // Update identity/profile.md if business info provided
      if (config.business) {
        const profilePath = path.join(tenantPath, 'identity', 'profile.md');
        if (fs.existsSync(profilePath)) {
          const profile = {
            version: 1,
            lastUpdated: new Date().toISOString(),
            name: config.name,
            industry: config.business.industry || 'Not specified',
            timezone: config.business.hours?.timezone || 'America/Denver',
            location: config.business.location || { city: '', state: '' },
          };

          const content = `---json
${JSON.stringify(profile, null, 2)}
---
# ${config.name}

## Overview

**Industry:** ${config.business.industry || '_Not specified_'}
**Location:** ${config.business.location?.city || '_Not specified_'}, ${config.business.location?.state || ''}
**Hours:** ${config.business.hours?.schedule || '_Not specified_'}
**Timezone:** ${config.business.hours?.timezone || 'America/Denver'}

## Owner

**Name:** ${config.business.owner?.name || '_Not specified_'}
**Role:** ${config.business.owner?.role || 'Owner'}
`;
          fs.writeFileSync(profilePath, content);
          console.log('  Updated identity/profile.md');
        }
      }
    } else {
      console.log('Step 5: No business info provided (skipping customization)');
    }

    // Step 6: Validate setup
    console.log('Step 6: Validating setup...');
    const expectedFiles = [
      'directives/README.md',
      'execution/tool_manifest.json',
      '.env',
      'CLAUDE.md',
    ];

    let allValid = true;
    for (const file of expectedFiles) {
      const filePath = path.join(tenantPath, file);
      if (!fs.existsSync(filePath)) {
        console.error(`  Missing: ${file}`);
        allValid = false;
      }
    }

    if (allValid) {
      console.log('  All required files present');
    }

    // Success summary
    console.log('');
    console.log('=' .repeat(50));
    console.log('SUCCESS! Customer setup complete.');
    console.log('=' .repeat(50));
    console.log('');
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Folder: ${tenantPath}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Add API credentials:');
    console.log(`     POST /admin/tenants/${tenantId}/credentials`);
    console.log('');
    console.log('  2. Customer links their account:');
    if (channel === 'TELEGRAM') {
      console.log(`     Send /start ${config.phone} in Telegram bot`);
    } else {
      console.log('     Send first message via WhatsApp');
    }
    console.log('');
    console.log('  3. Agent begins DISCOVERY mode automatically');

  } catch (error) {
    console.error('');
    console.error('Setup failed:', error);

    // Cleanup on failure
    if (fs.existsSync(tenantPath)) {
      console.log('Cleaning up tenant folder...');
      fs.rmSync(tenantPath, { recursive: true });
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
