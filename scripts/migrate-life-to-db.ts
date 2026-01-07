#!/usr/bin/env npx tsx
/**
 * Migrate life/*.md files to database tenant_memories table.
 *
 * Usage:
 *   npx tsx scripts/migrate-life-to-db.ts [tenant_id]
 *
 * If no tenant_id is provided, migrates all tenants.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ParsedFile {
  data: Record<string, unknown>;
  markdown: string;
}

/**
 * Parse JSON frontmatter from markdown content
 */
function parseFrontmatter(content: string): ParsedFile {
  const pattern = /^---json\s*\n(.*?)\n---\s*\n?(.*)$/s;
  const match = content.match(pattern);

  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const markdown = match[2] || '';
      return { data, markdown };
    } catch {
      return { data: {}, markdown: content };
    }
  }

  return { data: {}, markdown: content };
}

/**
 * Get memory type from file name
 */
function getMemoryType(fileName: string): string {
  // Remove .md extension and path
  const base = path.basename(fileName, '.md');

  // Map file names to memory types
  const mappings: Record<string, string> = {
    'profile': 'identity',
    'identity': 'identity',
    'boundaries': 'boundaries',
    'patterns': 'patterns',
    'questions': 'questions',
    'people': 'relationships',
    'contacts': 'relationships',
    'services': 'services',
    'pricing': 'pricing',
    'faqs': 'faqs',
    'policies': 'policies',
  };

  return mappings[base] || base;
}

/**
 * Migrate life files for a single tenant
 */
async function migrateTenant(tenantId: string, tenantFolder: string): Promise<number> {
  let migratedCount = 0;

  // Directories to scan for life files
  const lifeDirs = [
    path.join(tenantFolder, 'life'),
    path.join(tenantFolder, 'identity'),
    path.join(tenantFolder, 'knowledge'),
  ];

  for (const dir of lifeDirs) {
    if (!fs.existsSync(dir)) continue;

    // Scan for .md files
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data, markdown } = parseFrontmatter(content);

      // Skip empty files
      if (Object.keys(data).length === 0 && !markdown.trim()) {
        console.log(`  Skipping empty file: ${file}`);
        continue;
      }

      const memoryType = getMemoryType(file);

      try {
        await prisma.tenant_memories.upsert({
          where: {
            tenant_id_memory_type: {
              tenant_id: tenantId,
              memory_type: memoryType,
            },
          },
          update: {
            data: data,
            markdown: markdown,
            version: { increment: 1 },
          },
          create: {
            tenant_id: tenantId,
            memory_type: memoryType,
            data: data,
            markdown: markdown,
            version: 1,
          },
        });

        console.log(`  ✓ Migrated ${file} → ${memoryType}`);
        migratedCount++;
      } catch (error) {
        console.error(`  ✗ Failed to migrate ${file}: ${error}`);
      }
    }

    // Handle relationships subdirectory
    const relationshipsDir = path.join(dir, 'relationships');
    if (fs.existsSync(relationshipsDir) && fs.statSync(relationshipsDir).isDirectory()) {
      const relFiles = fs.readdirSync(relationshipsDir).filter(f => f.endsWith('.md'));

      for (const file of relFiles) {
        const filePath = path.join(relationshipsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const { data, markdown } = parseFrontmatter(content);

        if (Object.keys(data).length === 0 && !markdown.trim()) continue;

        const memoryType = 'relationships';

        try {
          await prisma.tenant_memories.upsert({
            where: {
              tenant_id_memory_type: {
                tenant_id: tenantId,
                memory_type: memoryType,
              },
            },
            update: {
              data: data,
              markdown: markdown,
              version: { increment: 1 },
            },
            create: {
              tenant_id: tenantId,
              memory_type: memoryType,
              data: data,
              markdown: markdown,
              version: 1,
            },
          });

          console.log(`  ✓ Migrated relationships/${file} → ${memoryType}`);
          migratedCount++;
        } catch (error) {
          console.error(`  ✗ Failed to migrate relationships/${file}: ${error}`);
        }
      }
    }
  }

  return migratedCount;
}

async function main() {
  const specificTenant = process.argv[2];
  const tenantsDir = path.join(process.cwd(), 'tenants');

  if (!fs.existsSync(tenantsDir)) {
    console.error('Error: tenants directory not found');
    process.exit(1);
  }

  // Get list of tenants
  let tenants: string[];
  if (specificTenant) {
    tenants = [specificTenant];
  } else {
    tenants = fs.readdirSync(tenantsDir)
      .filter(d => !d.startsWith('_') && !d.startsWith('.'))
      .filter(d => fs.statSync(path.join(tenantsDir, d)).isDirectory());
  }

  console.log(`Migrating life files to database for ${tenants.length} tenant(s)...\n`);

  let totalMigrated = 0;

  for (const tenantId of tenants) {
    const tenantFolder = path.join(tenantsDir, tenantId);

    // Verify tenant exists in database
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      console.log(`⚠ Tenant ${tenantId} not found in database, skipping`);
      continue;
    }

    console.log(`\nMigrating tenant: ${tenantId}`);
    const count = await migrateTenant(tenantId, tenantFolder);
    totalMigrated += count;
  }

  console.log(`\n✓ Migration complete. Migrated ${totalMigrated} files.`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
