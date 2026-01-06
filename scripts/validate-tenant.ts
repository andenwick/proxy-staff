#!/usr/bin/env npx tsx
/**
 * Validate a tenant's folder setup.
 *
 * Usage: npx tsx scripts/validate-tenant.ts <tenant-uuid>
 *
 * This script checks:
 * 1. Tenant folder exists
 * 2. tool_manifest.json is valid JSON with correct schema
 * 3. All referenced script files exist
 * 4. .env file is present (warning if missing)
 * 5. directives folder and README.md exist
 */

import * as fs from 'fs';
import * as path from 'path';

// Project paths
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validation result tracking
interface ValidationResult {
  errors: string[];
  warnings: string[];
  info: string[];
}

/**
 * Validate the tool manifest structure and content
 */
function validateToolManifest(
  manifestPath: string,
  executionPath: string,
  result: ValidationResult
): void {
  // Check if manifest exists
  if (!fs.existsSync(manifestPath)) {
    result.errors.push('tool_manifest.json not found in execution/ folder');
    return;
  }

  // Read and parse manifest
  let manifestContent: string;
  try {
    manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  } catch (error) {
    result.errors.push(`Cannot read tool_manifest.json: ${error}`);
    return;
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    result.errors.push(`tool_manifest.json is not valid JSON: ${error}`);
    return;
  }

  result.info.push('tool_manifest.json is valid JSON');

  // Validate structure
  if (!manifest || typeof manifest !== 'object') {
    result.errors.push('tool_manifest.json must be an object');
    return;
  }

  const m = manifest as Record<string, unknown>;

  if (!('tools' in m)) {
    result.errors.push('tool_manifest.json is missing "tools" array');
    return;
  }

  if (!Array.isArray(m.tools)) {
    result.errors.push('tool_manifest.json "tools" must be an array');
    return;
  }

  result.info.push(`Found ${m.tools.length} tool(s) in manifest`);

  // Validate each tool
  for (let i = 0; i < m.tools.length; i++) {
    const tool = m.tools[i] as Record<string, unknown>;
    const toolPrefix = `Tool[${i}]`;

    if (!tool || typeof tool !== 'object') {
      result.errors.push(`${toolPrefix}: must be an object`);
      continue;
    }

    // Check required fields
    if (typeof tool.name !== 'string' || !tool.name.trim()) {
      result.errors.push(`${toolPrefix}: missing or invalid "name" (must be non-empty string)`);
    } else {
      result.info.push(`${toolPrefix}: name = "${tool.name}"`);
    }

    if (typeof tool.description !== 'string' || !tool.description.trim()) {
      result.errors.push(`${toolPrefix}: missing or invalid "description" (must be non-empty string)`);
    }

    if (typeof tool.script !== 'string' || !tool.script.trim()) {
      result.errors.push(`${toolPrefix}: missing or invalid "script" (must be non-empty string)`);
    } else {
      // Verify script file exists
      const scriptPath = path.join(executionPath, tool.script);
      if (!fs.existsSync(scriptPath)) {
        result.errors.push(
          `${toolPrefix}: script file not found: ${tool.script}`
        );
      } else {
        result.info.push(`${toolPrefix}: script file exists: ${tool.script}`);
      }
    }

    // Validate input_schema
    if (!tool.input_schema || typeof tool.input_schema !== 'object') {
      result.errors.push(`${toolPrefix}: missing or invalid "input_schema" (must be object)`);
    } else {
      const schema = tool.input_schema as Record<string, unknown>;
      if (schema.type !== 'object') {
        result.errors.push(`${toolPrefix}: input_schema.type must be "object"`);
      }
      if (!schema.properties || typeof schema.properties !== 'object') {
        result.warnings.push(`${toolPrefix}: input_schema.properties is missing or invalid`);
      }
    }
  }
}

/**
 * Validate directives folder
 */
function validateDirectives(
  directivesPath: string,
  result: ValidationResult
): void {
  if (!fs.existsSync(directivesPath)) {
    result.warnings.push('directives/ folder not found');
    return;
  }

  if (!fs.statSync(directivesPath).isDirectory()) {
    result.errors.push('directives/ exists but is not a directory');
    return;
  }

  result.info.push('directives/ folder exists');

  // Check for README.md (system prompt)
  const readmePath = path.join(directivesPath, 'README.md');
  if (!fs.existsSync(readmePath)) {
    result.warnings.push('directives/README.md not found (system prompt)');
  } else {
    const content = fs.readFileSync(readmePath, 'utf-8');
    if (content.trim().length === 0) {
      result.warnings.push('directives/README.md is empty');
    } else {
      result.info.push('directives/README.md exists and has content');
    }
  }

  // List other directive files
  const files = fs.readdirSync(directivesPath);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'README.md');
  if (mdFiles.length > 0) {
    result.info.push(`Found ${mdFiles.length} additional directive(s): ${mdFiles.join(', ')}`);
  }
}

function main(): void {
  // Get tenant UUID from command line
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error('Error: Tenant UUID is required');
    console.error('Usage: npx tsx scripts/validate-tenant.ts <tenant-uuid>');
    process.exit(1);
  }

  // Validate UUID format
  if (!UUID_REGEX.test(tenantId)) {
    console.error(`Error: Invalid UUID format: ${tenantId}`);
    console.error('UUID must be in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    process.exit(1);
  }

  const tenantPath = path.join(TENANTS_DIR, tenantId);

  console.log('');
  console.log('========================================');
  console.log(`Validating tenant: ${tenantId}`);
  console.log('========================================');
  console.log('');

  // Check if tenant folder exists
  if (!fs.existsSync(tenantPath)) {
    console.error(`FAIL: Tenant folder not found: ${tenantPath}`);
    console.error('');
    console.error('Run this command to create it:');
    console.error(`  npx tsx scripts/init-tenant.ts ${tenantId}`);
    process.exit(1);
  }

  const result: ValidationResult = {
    errors: [],
    warnings: [],
    info: [],
  };

  // Validate execution folder and tool manifest
  const executionPath = path.join(tenantPath, 'execution');
  const manifestPath = path.join(executionPath, 'tool_manifest.json');

  if (!fs.existsSync(executionPath)) {
    result.warnings.push('execution/ folder not found');
  } else {
    result.info.push('execution/ folder exists');
    validateToolManifest(manifestPath, executionPath, result);
  }

  // Validate directives folder
  const directivesPath = path.join(tenantPath, 'directives');
  validateDirectives(directivesPath, result);

  // Check for .env file
  const envPath = path.join(tenantPath, '.env');
  if (!fs.existsSync(envPath)) {
    result.warnings.push('.env file is missing (tenant scripts may not have access to credentials)');
  } else {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const hasRealValues = envContent.split('\n').some(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && trimmed.includes('=');
    });
    if (hasRealValues) {
      result.info.push('.env file exists with configured values');
    } else {
      result.warnings.push('.env file exists but appears to have no configured values');
    }
  }

  // Print results
  console.log('--- Info ---');
  if (result.info.length === 0) {
    console.log('  (none)');
  } else {
    for (const info of result.info) {
      console.log(`  [INFO] ${info}`);
    }
  }

  console.log('');
  console.log('--- Warnings ---');
  if (result.warnings.length === 0) {
    console.log('  (none)');
  } else {
    for (const warning of result.warnings) {
      console.log(`  [WARN] ${warning}`);
    }
  }

  console.log('');
  console.log('--- Errors ---');
  if (result.errors.length === 0) {
    console.log('  (none)');
  } else {
    for (const error of result.errors) {
      console.log(`  [ERROR] ${error}`);
    }
  }

  // Final status
  console.log('');
  console.log('========================================');
  if (result.errors.length === 0) {
    console.log('VALIDATION PASSED');
    if (result.warnings.length > 0) {
      console.log(`(with ${result.warnings.length} warning(s))`);
    }
    console.log('========================================');
    process.exit(0);
  } else {
    console.log(`VALIDATION FAILED (${result.errors.length} error(s), ${result.warnings.length} warning(s))`);
    console.log('========================================');
    process.exit(1);
  }
}

main();
