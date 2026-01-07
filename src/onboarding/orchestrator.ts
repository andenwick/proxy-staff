/**
 * Onboarding Orchestrator
 * Main service for creating and populating tenant folders
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import {
  OnboardingResponse,
  ValidationResult,
  ValidationError,
  GenerationResult,
  Question,
  BusinessProfile,
  VoiceProfile,
  ServiceOffering,
  PricingInfo,
  Goals,
  WorkflowDefinition,
} from './types.js';
import { allQuestions, QUESTION_CATEGORIES } from './questions.js';
import { generateAllFiles } from './fileGenerator.js';
import { generateClaudeMd } from './claudeGenerator.js';

// Default tenant root
const TENANTS_ROOT = path.join(process.cwd(), 'tenants');

/**
 * Onboarding Orchestrator class
 */
export class OnboardingOrchestrator {
  private tenantsRoot: string;

  constructor(tenantsRoot?: string) {
    this.tenantsRoot = tenantsRoot || TENANTS_ROOT;
  }

  /**
   * Create tenant folder structure (v2)
   */
  async createTenant(tenantId: string): Promise<string> {
    const tenantPath = path.join(this.tenantsRoot, tenantId);

    // Check if tenant already exists
    try {
      await fs.access(tenantPath);
      throw new Error(`Tenant ${tenantId} already exists at ${tenantPath}`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Create v2 folder structure
    const folders = [
      '',
      'identity',
      'identity/brand',
      'knowledge',
      'relationships',
      'relationships/clients',
      'relationships/prospects',
      'relationships/contacts',
      'operations',
      'operations/workflows',
      'operations/campaigns',
      'operations/schedules',
      'operations/state',
      'execution',
      'data',
      'data/imports',
      'data/sync',
      'timeline',
      'history',
      '.claude',
      '.backups',
      '.staging',
    ];

    for (const folder of folders) {
      await fs.mkdir(path.join(tenantPath, folder), { recursive: true });
    }

    // Create empty tool manifest
    await fs.writeFile(
      path.join(tenantPath, 'execution', 'tool_manifest.json'),
      JSON.stringify({ tools: [] }, null, 2)
    );

    // Create empty .env
    await fs.writeFile(
      path.join(tenantPath, '.env'),
      '# Tenant credentials\n# Add API keys and secrets here\n'
    );

    return tenantPath;
  }

  /**
   * Run interactive interview via CLI
   */
  async runInterview(): Promise<OnboardingResponse> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (question: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      });
    };

    console.log('\n=== ProxyStaff Onboarding Interview ===\n');
    console.log('Answer the following questions to configure your AI assistant.\n');

    const responses: Record<string, string | string[]> = {};

    for (const category of QUESTION_CATEGORIES) {
      const categoryQuestions = allQuestions.filter((q) => q.category === category);
      console.log(`\n--- ${category.toUpperCase()} ---\n`);

      for (const q of categoryQuestions) {
        let answer: string | string[];

        if (q.type === 'select' && q.options) {
          console.log(`${q.question}`);
          q.options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
          const idx = await ask(`Enter number [${q.default || 1}]: `);
          const selected = parseInt(idx) - 1;
          answer = q.options[selected]?.value || (q.default as string) || q.options[0].value;
        } else if (q.type === 'multi-select' && q.options) {
          console.log(`${q.question}`);
          q.options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
          const indices = await ask('Enter numbers separated by commas: ');
          if (indices) {
            answer = indices
              .split(',')
              .map((i) => q.options![parseInt(i.trim()) - 1]?.value)
              .filter(Boolean);
          } else {
            answer = (q.default as string[]) || [];
          }
        } else if (q.type === 'multiline') {
          console.log(`${q.question} (enter empty line to finish):`);
          const lines: string[] = [];
          let line = await ask('> ');
          while (line) {
            lines.push(line);
            line = await ask('> ');
          }
          answer = lines.join('\n');
        } else if (q.type === 'list') {
          console.log(`${q.question} (comma-separated):`);
          const input = await ask(`[${q.placeholder || ''}]: `);
          answer = input ? input.split(',').map((s) => s.trim()) : [];
        } else {
          const defaultHint = q.default ? ` [${q.default}]` : '';
          answer = await ask(`${q.question}${defaultHint}: `) || (q.default as string) || '';
        }

        responses[q.id] = answer;
      }
    }

    rl.close();

    // Transform responses to OnboardingResponse
    return this.transformResponses(responses);
  }

  /**
   * Load interview responses from JSON file
   */
  async loadInterviewFromFile(filePath: string): Promise<OnboardingResponse> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Validate structure
    const validation = this.validateResponse(data);
    if (!validation.valid) {
      throw new Error(
        `Invalid interview file: ${validation.errors.map((e) => e.message).join(', ')}`
      );
    }

    return data as OnboardingResponse;
  }

  /**
   * Transform raw question responses to OnboardingResponse
   */
  private transformResponses(
    responses: Record<string, string | string[]>
  ): OnboardingResponse {
    // Parse services from multiline input
    const servicesText = (responses.services_list as string) || '';
    const services: ServiceOffering[] = servicesText
      .split('\n')
      .filter(Boolean)
      .map((name) => ({
        name: name.trim(),
        description: '',
      }));

    // Parse enabled workflows
    const enabledWorkflows = (responses.enabled_workflows as string[]) || [];
    const workflows: WorkflowDefinition[] = [
      { id: 'lead-handling', name: 'Lead Handling', enabled: enabledWorkflows.includes('lead-handling') },
      { id: 'appointment-scheduling', name: 'Appointment Scheduling', enabled: enabledWorkflows.includes('appointment-scheduling') },
      { id: 'follow-up', name: 'Follow-up', enabled: enabledWorkflows.includes('follow-up') },
      { id: 'inquiry-response', name: 'Inquiry Response', enabled: enabledWorkflows.includes('inquiry-response') },
      { id: 'email-management', name: 'Email Management', enabled: enabledWorkflows.includes('email-management') },
    ];

    // Parse goals
    const painPointsText = (responses.pain_points as string) || '';
    const tasksText = (responses.tasks_to_automate as string) || '';
    const metricsText = (responses.success_metrics as string) || '';

    const goals: Goals = {
      primaryObjective: (responses.primary_objective as string) || '',
      painPoints: painPointsText.split('\n').filter(Boolean),
      tasksToAutomate: tasksText.split('\n').filter(Boolean),
      successMetrics: metricsText.split('\n').filter(Boolean),
    };

    const business: BusinessProfile = {
      name: (responses.business_name as string) || '',
      industry: (responses.industry as string) || '',
      location: {
        city: (responses.location_city as string) || '',
        state: (responses.location_state as string) || '',
      },
      hours: {
        timezone: (responses.timezone as string) || 'America/Denver',
        schedule: (responses.business_hours as string) || 'Mon-Fri 9am-5pm',
      },
      owner: {
        name: (responses.owner_name as string) || '',
        role: (responses.owner_role as string) || 'Owner',
      },
    };

    const voice: VoiceProfile = {
      tone: (responses.tone as 'professional' | 'casual' | 'friendly' | 'formal' | 'conversational') || 'friendly',
      style: (responses.style as 'concise' | 'detailed' | 'conversational') || 'concise',
      personality: (responses.personality_traits as string[]) || ['helpful', 'knowledgeable'],
      avoidWords: (responses.avoid_words as string[]) || [],
      preferWords: (responses.prefer_words as string[]) || [],
    };

    const pricing: PricingInfo = {
      model: (responses.pricing_model as 'hourly' | 'per-project' | 'subscription' | 'custom') || 'custom',
      ranges: (responses.price_ranges as string) || '',
      paymentTerms: (responses.payment_terms as string) || '',
    };

    return {
      tenantId: '',
      collectedAt: new Date().toISOString(),
      business,
      voice,
      services,
      pricing,
      faqs: [],
      policies: [],
      workflows,
      goals,
    };
  }

  /**
   * Validate onboarding response
   */
  validateResponse(data: Partial<OnboardingResponse>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!data.business?.name) {
      errors.push({ field: 'business.name', message: 'Business name is required' });
    }
    if (!data.business?.industry) {
      errors.push({ field: 'business.industry', message: 'Industry is required' });
    }
    if (!data.business?.owner?.name) {
      errors.push({ field: 'business.owner.name', message: 'Owner name is required' });
    }

    // Warnings for missing optional data
    if (!data.services?.length) {
      warnings.push('No services defined - consider adding at least one');
    }
    if (!data.goals?.primaryObjective) {
      warnings.push('No primary objective defined');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Generate all files for a tenant
   */
  async generateFiles(
    tenantId: string,
    responses: OnboardingResponse
  ): Promise<GenerationResult> {
    const tenantPath = path.join(this.tenantsRoot, tenantId);
    const errors: string[] = [];

    // Update tenant ID in responses
    responses.tenantId = tenantId;

    try {
      // Generate content files
      const files = await generateAllFiles(responses);

      // Generate CLAUDE.md
      const claudeMd = await generateClaudeMd(responses, tenantPath);
      files.push(claudeMd);

      // Write all files
      for (const file of files) {
        const filePath = path.join(tenantPath, file.path);
        const dir = path.dirname(filePath);

        // Ensure directory exists
        await fs.mkdir(dir, { recursive: true });

        // Write file
        await fs.writeFile(filePath, file.content, 'utf-8');
      }

      return {
        success: true,
        files,
        errors: [],
      };
    } catch (error) {
      errors.push(String(error));
      return {
        success: false,
        files: [],
        errors,
      };
    }
  }

  /**
   * Validate a tenant folder for completeness
   */
  async validateTenant(tenantId: string): Promise<ValidationResult> {
    const tenantPath = path.join(this.tenantsRoot, tenantId);
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Required files
    const requiredFiles = [
      'CLAUDE.md',
      'identity/profile.md',
      'identity/voice.md',
      'knowledge/services.md',
    ];

    for (const file of requiredFiles) {
      try {
        await fs.access(path.join(tenantPath, file));
      } catch {
        errors.push({ field: file, message: `Missing required file: ${file}` });
      }
    }

    // Check for at least one workflow
    try {
      const workflows = await fs.readdir(path.join(tenantPath, 'operations/workflows'));
      if (workflows.length === 0) {
        warnings.push('No workflows defined in operations/workflows/');
      }
    } catch {
      warnings.push('operations/workflows/ directory not found');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Full onboarding flow: create tenant + interview + generate files
   */
  async onboard(
    tenantId: string,
    options: { interactive?: boolean; fromFile?: string } = {}
  ): Promise<GenerationResult> {
    // Create tenant folder
    console.log(`Creating tenant folder: ${tenantId}`);
    await this.createTenant(tenantId);

    // Get responses
    let responses: OnboardingResponse;
    if (options.fromFile) {
      console.log(`Loading responses from: ${options.fromFile}`);
      responses = await this.loadInterviewFromFile(options.fromFile);
    } else if (options.interactive) {
      responses = await this.runInterview();
    } else {
      throw new Error('Must specify --interactive or --from-file');
    }

    // Validate
    const validation = this.validateResponse(responses);
    if (!validation.valid) {
      throw new Error(
        `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
      );
    }

    if (validation.warnings.length) {
      console.log('\nWarnings:');
      validation.warnings.forEach((w) => console.log(`  - ${w}`));
    }

    // Generate files
    console.log('\nGenerating files...');
    const result = await this.generateFiles(tenantId, responses);

    if (result.success) {
      console.log(`\nSuccess! Created ${result.files.length} files.`);
      result.files.forEach((f) => console.log(`  - ${f.path}`));
    } else {
      console.error('\nErrors:', result.errors);
    }

    return result;
  }
}

// Export singleton for convenience
export const orchestrator = new OnboardingOrchestrator();
