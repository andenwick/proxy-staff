#!/usr/bin/env npx tsx
/**
 * Onboarding CLI
 * Create and configure new tenants
 *
 * Usage:
 *   npx tsx scripts/onboard.ts --tenant <id> --interactive
 *   npx tsx scripts/onboard.ts --tenant <id> --from-file <path>
 *   npx tsx scripts/onboard.ts --tenant <id> --dry-run --from-file <path>
 */

import { OnboardingOrchestrator } from '../src/onboarding/orchestrator.js';

interface CliArgs {
  tenant?: string;
  interactive?: boolean;
  fromFile?: string;
  dryRun?: boolean;
  help?: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--tenant':
      case '-t':
        args.tenant = argv[++i];
        break;
      case '--interactive':
      case '-i':
        args.interactive = true;
        break;
      case '--from-file':
      case '-f':
        args.fromFile = argv[++i];
        break;
      case '--dry-run':
      case '-d':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
    }
  }

  return args;
}

function showHelp(): void {
  console.log(`
ProxyStaff Onboarding CLI

Usage:
  npx tsx scripts/onboard.ts [options]

Options:
  --tenant, -t <id>       Tenant ID (required)
  --interactive, -i       Run interactive interview
  --from-file, -f <path>  Load responses from JSON file
  --dry-run, -d           Preview without writing files
  --help, -h              Show this help message

Examples:
  # Interactive onboarding
  npx tsx scripts/onboard.ts --tenant acme-corp --interactive

  # From JSON file
  npx tsx scripts/onboard.ts --tenant acme-corp --from-file ./responses.json

  # Dry run (preview)
  npx tsx scripts/onboard.ts --tenant acme-corp --from-file ./responses.json --dry-run

JSON File Format:
  {
    "business": {
      "name": "Acme Corp",
      "industry": "consulting",
      "location": { "city": "Salt Lake City", "state": "Utah" },
      "hours": { "timezone": "America/Denver", "schedule": "Mon-Fri 9am-5pm" },
      "owner": { "name": "John Smith", "role": "Founder" }
    },
    "voice": {
      "tone": "friendly",
      "style": "concise",
      "personality": ["helpful", "knowledgeable"],
      "avoidWords": [],
      "preferWords": []
    },
    "services": [
      { "name": "Business Consulting", "description": "Strategic advice..." }
    ],
    "pricing": { "model": "hourly", "ranges": "$150-300/hr" },
    "faqs": [],
    "policies": [],
    "workflows": [
      { "id": "lead-handling", "name": "Lead Handling", "enabled": true }
    ],
    "goals": {
      "primaryObjective": "Respond to leads instantly",
      "painPoints": ["Missing calls"],
      "tasksToAutomate": ["Lead response"],
      "successMetrics": ["Response time under 5 min"]
    }
  }
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!args.tenant) {
    console.error('Error: --tenant is required');
    showHelp();
    process.exit(1);
  }

  if (!args.interactive && !args.fromFile) {
    console.error('Error: Must specify --interactive or --from-file');
    showHelp();
    process.exit(1);
  }

  const orchestrator = new OnboardingOrchestrator();

  try {
    if (args.dryRun) {
      console.log('\n=== DRY RUN MODE ===\n');
      console.log(`Would create tenant: ${args.tenant}`);

      if (args.fromFile) {
        const responses = await orchestrator.loadInterviewFromFile(args.fromFile);
        const validation = orchestrator.validateResponse(responses);

        console.log('\nValidation:');
        console.log(`  Valid: ${validation.valid}`);

        if (validation.errors.length) {
          console.log('  Errors:');
          validation.errors.forEach((e) => console.log(`    - ${e.field}: ${e.message}`));
        }

        if (validation.warnings.length) {
          console.log('  Warnings:');
          validation.warnings.forEach((w) => console.log(`    - ${w}`));
        }

        console.log('\nWould generate files for:');
        console.log(`  Business: ${responses.business.name}`);
        console.log(`  Industry: ${responses.business.industry}`);
        console.log(`  Services: ${responses.services.map((s) => s.name).join(', ')}`);
        console.log(
          `  Workflows: ${responses.workflows.filter((w) => w.enabled).map((w) => w.id).join(', ')}`
        );
      }

      console.log('\nDry run complete. No files were created.');
    } else {
      const result = await orchestrator.onboard(args.tenant, {
        interactive: args.interactive,
        fromFile: args.fromFile,
      });

      if (result.success) {
        console.log('\n=== Onboarding Complete ===');
        console.log(`Tenant: ${args.tenant}`);
        console.log(`Files created: ${result.files.length}`);
        console.log('\nNext steps:');
        console.log('  1. Review generated files in tenants/' + args.tenant);
        console.log('  2. Add credentials to .env');
        console.log('  3. Configure tools in execution/tool_manifest.json');
        console.log('  4. Create database entry for tenant');
      } else {
        console.error('\nOnboarding failed:', result.errors);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();
