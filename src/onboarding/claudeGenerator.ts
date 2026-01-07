/**
 * CLAUDE.md Generator
 * Generates a customized CLAUDE.md file from onboarding data
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { OnboardingResponse, GeneratedFile } from './types.js';

interface ToolManifest {
  tools: Array<{
    name: string;
    description: string;
    script: string;
    input_schema?: Record<string, unknown>;
  }>;
}

/**
 * Load tool manifest from tenant folder
 */
async function loadToolManifest(tenantPath: string): Promise<ToolManifest | null> {
  try {
    const manifestPath = path.join(tenantPath, 'execution', 'tool_manifest.json');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Generate tool documentation section from manifest
 */
function generateToolDocs(manifest: ToolManifest | null): string {
  if (!manifest?.tools?.length) {
    return `## Execution Tools

No custom tools configured. Use the built-in shared_tools for scheduling and history.`;
  }

  const toolRows = manifest.tools
    .map((t) => `| \`mcp__tools__${t.name}\` | ${t.description} |`)
    .join('\n');

  return `## Execution Tools (execution/)

These are your main tools. They are exposed as MCP tools with the prefix \`mcp__tools__\`.

| MCP Tool | Description |
|----------|-------------|
${toolRows}`;
}

/**
 * Generate the core architecture section (static)
 */
function generateCoreSection(): string {
  return `## Architecture: 3-Layer System

This system separates probabilistic LLM work from deterministic execution to maximize reliability.

**Layer 1: Directives**
- SOPs written in Markdown defining goals, inputs, tools, outputs, edge cases
- Natural language instructions—like you'd give a mid-level employee
- Load with \`read_directive\` tool when you need specific procedures

**Layer 2: Orchestration (You)**
- Intelligent routing: read directives → call execution tools → handle errors
- Don't do complex tasks yourself—read the relevant directive, then use the appropriate tool

**Layer 3: Execution (Tools)**
- Deterministic Python scripts for API calls, data processing, external services
- Called via tool use with structured JSON input/output

**Why this matters:** 90% accuracy per step = 59% success over 5 steps. Push complexity into deterministic tools.`;
}

/**
 * Generate operating principles section
 */
function generatePrinciplesSection(): string {
  return `## Operating Principles

1. **Check for tools first** — Look at available tools before attempting complex tasks manually
2. **Load directives when unsure** — Use \`read_directive\` to get specific SOPs before acting
3. **Be concise** — Messages should be brief and actionable
4. **Ask for clarification** — If a request is ambiguous, ask before proceeding
5. **Always attempt before giving up** — NEVER say "this won't work" without actually trying

## How to Work

1. Receive user message
2. If task matches a directive, load it with \`read_directive\`
3. If task requires external action, use the appropriate tool
4. Respond concisely with results or next steps
5. If something fails, explain clearly and suggest alternatives`;
}

/**
 * Generate built-in tools section
 */
function generateBuiltInToolsSection(): string {
  return `## Built-in Tools (shared_tools/)

These Python scripts are in the \`shared_tools/\` folder. Call them via bash with JSON input:

\`\`\`bash
echo '{"task": "send reminder", "schedule": "in 1 hour", "task_type": "reminder"}' | python shared_tools/schedule_task.py
\`\`\`

Available scripts:
- **schedule_task.py** - Schedule tasks. Input: \`{"task": "description", "schedule": "every 2 minutes", "task_type": "execute|reminder"}\`
- **list_schedules.py** - List scheduled tasks. Input: \`{}\`
- **cancel_schedule.py** - Cancel a task. Input: \`{"task_id": "uuid"}\`
- **search_history.py** - Search conversation history. Input: \`{"query": "search term"}\`
- **get_current_time.py** - Get current time. Input: \`{"timezone": "America/Denver"}\``;
}

/**
 * Generate business context section from onboarding data
 */
function generateBusinessContext(data: OnboardingResponse): string {
  const services = data.services.map((s) => s.name).join(', ');
  const workflows = data.workflows
    .filter((w) => w.enabled)
    .map((w) => w.name)
    .join(', ');

  return `## Business Context

**Business:** ${data.business.name}
**Industry:** ${data.business.industry}
**Location:** ${data.business.location.city}, ${data.business.location.state}
**Owner:** ${data.business.owner.name} (${data.business.owner.role})

### Services Offered
${services || '_Not configured_'}

### Active Workflows
${workflows || '_None configured_'}

### Primary Objective
${data.goals.primaryObjective || '_Not defined_'}`;
}

/**
 * Generate communication guidelines from voice profile
 */
function generateCommunicationSection(data: OnboardingResponse): string {
  const { voice } = data;

  return `## Communication Guidelines

- **Tone:** ${voice.tone}
- **Style:** ${voice.style}
- **Personality:** ${voice.personality.join(', ') || 'Helpful, knowledgeable'}

${voice.avoidWords.length ? `### Words to Avoid\n${voice.avoidWords.map((w) => `- "${w}"`).join('\n')}` : ''}

${voice.preferWords.length ? `### Preferred Terminology\n${voice.preferWords.map((w) => `- "${w}"`).join('\n')}` : ''}

### General Guidelines
- Keep messages concise and mobile-friendly
- Use simple formatting
- Be responsive and helpful
- When unsure, ask for clarification`;
}

/**
 * Generate available directives section
 */
function generateDirectivesSection(data: OnboardingResponse): string {
  const enabledWorkflows = data.workflows.filter((w) => w.enabled);

  if (!enabledWorkflows.length) {
    return `## Directives Available

No workflows configured. Add SOPs to \`operations/workflows/\` as needed.`;
  }

  const workflowList = enabledWorkflows
    .map((w) => `- \`${w.id}\` - ${w.name}`)
    .join('\n');

  return `## Directives Available

Load these with \`read_directive\` for detailed procedures:

${workflowList}`;
}

/**
 * Generate complete CLAUDE.md content
 */
export async function generateClaudeMd(
  data: OnboardingResponse,
  tenantPath?: string
): Promise<GeneratedFile> {
  // Load tool manifest if tenant path provided
  const manifest = tenantPath ? await loadToolManifest(tenantPath) : null;

  const sections = [
    `# System Prompt`,
    '',
    `You are an AI assistant for ${data.business.name}. You sit between human intent (directives) and deterministic execution (Python tools).`,
    '',
    `**CRITICAL RULE**: You MUST actually call tools to perform actions. NEVER say you did something without calling the tool. If a user asks to schedule something, you MUST call the scheduling tool. If you don't call the tool, the action DID NOT happen.`,
    '',
    generateCoreSection(),
    '',
    generatePrinciplesSection(),
    '',
    generateToolDocs(manifest),
    '',
    generateBuiltInToolsSection(),
    '',
    generateBusinessContext(data),
    '',
    generateDirectivesSection(data),
    '',
    generateCommunicationSection(data),
    '',
    '---',
    '',
    '## Summary',
    '',
    'Read instructions (directives), make decisions, call tools, handle errors. Be pragmatic. Be reliable. Be concise.',
  ];

  return {
    path: 'CLAUDE.md',
    content: sections.join('\n'),
  };
}
