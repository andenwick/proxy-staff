#!/usr/bin/env npx tsx
/**
 * Initialize a new tenant folder from the template.
 *
 * Usage: npx tsx scripts/init-tenant.ts <tenant-uuid>
 *
 * This script:
 * 1. Validates the tenant UUID exists in the database
 * 2. Copies all files from tenants/_template/ to tenants/<tenant-uuid>/
 * 3. Renames .env.example to .env
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// Project paths
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
const TEMPLATE_DIR = path.join(TENANTS_DIR, '_template');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reserved folder names
const RESERVED_NAMES = ['_template', '.', '..'];

/**
 * Copy a directory recursively
 */
function copyDirRecursive(src: string, dest: string): void {
  // Create destination directory
  fs.mkdirSync(dest, { recursive: true });

  // Get all entries in source directory
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
      // Recursively copy subdirectory
      copyDirRecursive(srcPath, destPath);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main(): Promise<void> {
  // Get tenant UUID from command line
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error('Error: Tenant UUID is required');
    console.error('Usage: npx tsx scripts/init-tenant.ts <tenant-uuid>');
    process.exit(1);
  }

  // Validate UUID format
  if (!UUID_REGEX.test(tenantId)) {
    console.error(`Error: Invalid UUID format: ${tenantId}`);
    console.error('UUID must be in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    process.exit(1);
  }

  // Check for reserved names
  if (RESERVED_NAMES.includes(tenantId)) {
    console.error(`Error: "${tenantId}" is a reserved name and cannot be used`);
    process.exit(1);
  }

  // Check for path traversal attempts
  if (tenantId.includes('/') || tenantId.includes('\\') || tenantId.includes('..')) {
    console.error('Error: Invalid tenant ID (contains path characters)');
    process.exit(1);
  }

  const tenantPath = path.join(TENANTS_DIR, tenantId);

  // Check if tenant folder already exists
  if (fs.existsSync(tenantPath)) {
    console.error(`Error: Tenant folder already exists: ${tenantPath}`);
    process.exit(1);
  }

  // Verify template folder exists
  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`Error: Template folder not found: ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  // Connect to database and verify tenant exists
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(`Checking if tenant exists in database: ${tenantId}`);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });

    if (!tenant) {
      console.error(`Error: Tenant not found in database: ${tenantId}`);
      process.exit(1);
    }

    console.log(`Found tenant: ${tenant.name} (${tenant.id})`);

    // Copy template to tenant folder
    console.log(`Copying template files to: ${tenantPath}`);
    copyDirRecursive(TEMPLATE_DIR, tenantPath);

    // Verify the copy was successful
    const expectedFiles = [
      'directives/README.md',
      'execution/tool_manifest.json',
      'execution/example_tool.py',
      '.env',
    ];

    let allFilesPresent = true;
    for (const file of expectedFiles) {
      const filePath = path.join(tenantPath, file);
      if (!fs.existsSync(filePath)) {
        console.error(`Warning: Expected file not found: ${file}`);
        allFilesPresent = false;
      }
    }

    if (allFilesPresent) {
      console.log('');
      console.log('Success! Tenant folder created at:');
      console.log(`  ${tenantPath}`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Edit directives/README.md to customize the system prompt');
      console.log('  2. Add SOPs as .md files in directives/');
      console.log('  3. Add tool scripts in execution/ and update tool_manifest.json');
      console.log('  4. Add API keys to .env file');
      console.log('');
      console.log('Validate your setup with:');
      console.log(`  npx tsx scripts/validate-tenant.ts ${tenantId}`);
    } else {
      console.error('Warning: Some expected files were not copied correctly');
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
