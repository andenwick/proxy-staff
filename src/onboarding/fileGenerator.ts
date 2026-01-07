/**
 * File Generator
 * Generates tenant folder files from onboarding responses
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  OnboardingResponse,
  BusinessProfile,
  VoiceProfile,
  ServiceOffering,
  PricingInfo,
  FaqEntry,
  Policy,
  Goals,
  GeneratedFile,
} from './types.js';

// Template directory path (relative to compiled dist/ or src/)
const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * Generate JSON frontmatter for markdown files
 */
function jsonFrontmatter(data: Record<string, unknown>): string {
  return `---json\n${JSON.stringify(data, null, 2)}\n---\n`;
}

/**
 * Generate identity/profile.md
 */
export function generateProfileMd(business: BusinessProfile): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    name: business.name,
    industry: business.industry,
    timezone: business.hours.timezone,
    location: business.location,
  };

  const content = `${jsonFrontmatter(frontmatter)}
# ${business.name}

## Overview

**Industry:** ${business.industry}
**Location:** ${business.location.city}, ${business.location.state}
**Hours:** ${business.hours.schedule}
**Timezone:** ${business.hours.timezone}

## Owner

**Name:** ${business.owner.name}
**Role:** ${business.owner.role}
`;

  return {
    path: 'identity/profile.md',
    content,
  };
}

/**
 * Generate identity/voice.md
 */
export function generateVoiceMd(voice: VoiceProfile): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tone: voice.tone,
    style: voice.style,
    personality: voice.personality,
    avoidWords: voice.avoidWords,
    preferWords: voice.preferWords,
  };

  const content = `${jsonFrontmatter(frontmatter)}
# Voice & Communication Style

## Tone

Use a **${voice.tone}** tone in all communications.

## Style

Keep responses **${voice.style}**.

## Personality Traits

${voice.personality.map((t) => `- ${t}`).join('\n') || '- Helpful\n- Knowledgeable'}

## Words to Avoid

${voice.avoidWords.map((w) => `- "${w}"`).join('\n') || '_None specified_'}

## Preferred Terminology

${voice.preferWords.map((w) => `- "${w}"`).join('\n') || '_None specified_'}
`;

  return {
    path: 'identity/voice.md',
    content,
  };
}

/**
 * Generate knowledge/services.md
 */
export function generateServicesMd(services: ServiceOffering[]): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    services: services.map((s) => s.name),
    specializations: [],
  };

  const servicesList = services
    .map(
      (s) => `
### ${s.name}

${s.description || '_No description provided_'}

${s.targetCustomer ? `**Target Customer:** ${s.targetCustomer}` : ''}
${s.differentiators?.length ? `\n**What Sets Us Apart:**\n${s.differentiators.map((d) => `- ${d}`).join('\n')}` : ''}
`
    )
    .join('\n');

  const content = `${jsonFrontmatter(frontmatter)}
# Services

## What We Offer

${servicesList || '_No services defined yet_'}
`;

  return {
    path: 'knowledge/services.md',
    content,
  };
}

/**
 * Generate knowledge/pricing.md
 */
export function generatePricingMd(pricing: PricingInfo): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    model: pricing.model,
  };

  let tiersSection = '';
  if (pricing.tiers?.length) {
    tiersSection = `## Pricing Tiers\n\n${pricing.tiers
      .map(
        (t) => `### ${t.name} - ${t.price}\n\n${t.description}\n\n${t.features.map((f) => `- ${f}`).join('\n')}`
      )
      .join('\n\n')}`;
  }

  const content = `${jsonFrontmatter(frontmatter)}
# Pricing

## Pricing Model

**Type:** ${pricing.model}

${pricing.ranges ? `**Typical Range:** ${pricing.ranges}` : ''}

${pricing.paymentTerms ? `**Payment Terms:** ${pricing.paymentTerms}` : ''}

${tiersSection}

## Notes

- Always confirm current pricing before quoting
- Custom quotes available for larger projects
`;

  return {
    path: 'knowledge/pricing.md',
    content,
  };
}

/**
 * Generate knowledge/faqs.md
 */
export function generateFaqsMd(faqs: FaqEntry[]): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    count: faqs.length,
  };

  const faqsList = faqs.map((f) => `### ${f.question}\n\n${f.answer}`).join('\n\n');

  const content = `${jsonFrontmatter(frontmatter)}
# Frequently Asked Questions

${faqsList || '_No FAQs defined yet. Add common questions and answers here._'}
`;

  return {
    path: 'knowledge/faqs.md',
    content,
  };
}

/**
 * Generate knowledge/policies.md
 */
export function generatePoliciesMd(policies: Policy[]): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    policies: policies.map((p) => p.name),
  };

  const policiesList = policies.map((p) => `## ${p.name}\n\n${p.content}`).join('\n\n');

  const content = `${jsonFrontmatter(frontmatter)}
# Policies

${policiesList || '_No policies defined yet._'}
`;

  return {
    path: 'knowledge/policies.md',
    content,
  };
}

/**
 * Generate operations/state/goals.md
 */
export function generateGoalsMd(goals: Goals): GeneratedFile {
  const frontmatter = {
    version: 1,
    lastUpdated: new Date().toISOString(),
  };

  const content = `${jsonFrontmatter(frontmatter)}
# Goals & Objectives

## Primary Objective

${goals.primaryObjective || '_Not defined_'}

## Pain Points to Solve

${goals.painPoints.map((p) => `- ${p}`).join('\n') || '_None specified_'}

## Tasks to Automate

${goals.tasksToAutomate.map((t) => `- ${t}`).join('\n') || '_None specified_'}

## Success Metrics

${goals.successMetrics.map((m) => `- ${m}`).join('\n') || '_None specified_'}
`;

  return {
    path: 'operations/state/goals.md',
    content,
  };
}

/**
 * Replace placeholders in template content
 */
export function replacePlaceholders(
  template: string,
  data: OnboardingResponse
): string {
  const replacements: Record<string, string> = {
    '{{business_name}}': data.business.name,
    '{{owner_name}}': data.business.owner.name,
    '{{timezone}}': data.business.hours.timezone,
    '{{business_hours}}': data.business.hours.schedule,
    '{{tone}}': data.voice.tone,
    '{{style}}': data.voice.style,
    '{{service_list}}': data.services.map((s) => s.name).join(', '),
    '{{primary_service}}': data.services[0]?.name || 'our services',
    '{{followup_cadence}}': 'every 2 days', // Default, can be customized
    '{{email_check_frequency}}': 'twice daily',
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  return result;
}

/**
 * Load and process a workflow template
 */
export async function generateWorkflowMd(
  templateName: string,
  data: OnboardingResponse
): Promise<GeneratedFile> {
  const templatePath = path.join(TEMPLATES_DIR, 'workflows', `${templateName}.md`);
  const template = await fs.readFile(templatePath, 'utf-8');
  const content = replacePlaceholders(template, data);

  return {
    path: `operations/workflows/${templateName}.md`,
    content,
  };
}

/**
 * Generate all files from onboarding response
 */
export async function generateAllFiles(
  data: OnboardingResponse
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];

  // Core files
  files.push(generateProfileMd(data.business));
  files.push(generateVoiceMd(data.voice));
  files.push(generateServicesMd(data.services));
  files.push(generatePricingMd(data.pricing));
  files.push(generateFaqsMd(data.faqs));
  files.push(generatePoliciesMd(data.policies));
  files.push(generateGoalsMd(data.goals));

  // Workflow files based on enabled workflows
  for (const workflow of data.workflows) {
    if (workflow.enabled) {
      try {
        const workflowFile = await generateWorkflowMd(workflow.id, data);
        files.push(workflowFile);
      } catch (error) {
        console.warn(`Warning: Could not generate workflow ${workflow.id}:`, error);
      }
    }
  }

  return files;
}
