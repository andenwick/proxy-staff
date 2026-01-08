import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';
import { TelegramService, TelegramConfig } from './messaging/telegram.js';

/**
 * Wizard section identifiers.
 */
export type WizardSection =
  | 'icp'
  | 'pain_points'
  | 'value_prop'
  | 'objections'
  | 'voice'
  | 'timing';

/**
 * Status of a wizard session.
 */
export type WizardStatus = 'in_progress' | 'completed' | 'expired' | 'cancelled';

/**
 * A single interview question.
 */
export interface WizardQuestion {
  key: string;
  section: WizardSection;
  prompt: string;
  help_text?: string;
  required: boolean;
  order: number;
}

/**
 * Wizard state stored between interactions.
 */
export interface WizardState {
  id: string;
  tenant_id: string;
  campaign_name: string;
  status: WizardStatus;
  current_question_index: number;
  answers: Record<string, string>;
  created_at: string;
  updated_at: string;
  chat_id?: string;
}

/**
 * Data structure for active wizards storage.
 */
interface ActiveWizardsData {
  version: number;
  lastUpdated: string;
  wizards: Record<string, WizardState>;
}

/**
 * All interview questions organized by section.
 */
const WIZARD_QUESTIONS: WizardQuestion[] = [
  // Section 1: ICP Definition
  {
    key: 'industry',
    section: 'icp',
    prompt: 'What industry or vertical are you targeting? (e.g., "real estate agents", "SaaS companies", "healthcare providers")',
    help_text: 'Be as specific as possible about your ideal customer segment.',
    required: true,
    order: 1,
  },
  {
    key: 'company_size',
    section: 'icp',
    prompt: 'What company size are you targeting? (e.g., "solo practitioners", "small teams 2-10", "mid-market 50-200 employees")',
    required: true,
    order: 2,
  },
  {
    key: 'geographic_targeting',
    section: 'icp',
    prompt: 'What geographic area are you targeting? (e.g., "Salt Lake City metro", "Western US", "English-speaking countries")',
    required: true,
    order: 3,
  },
  {
    key: 'job_titles',
    section: 'icp',
    prompt: 'What job titles should we target? (e.g., "CEO, Founder, Owner", "VP of Sales, Sales Director")',
    required: true,
    order: 4,
  },
  {
    key: 'buying_signals',
    section: 'icp',
    prompt: 'What signals indicate someone might need your solution? (e.g., "recently hired, posted about challenges, growing team")',
    required: false,
    order: 5,
  },
  {
    key: 'disqualifiers',
    section: 'icp',
    prompt: 'What makes someone NOT a good fit? (e.g., "already has a competitor solution", "too large for our product")',
    required: false,
    order: 6,
  },

  // Section 2: Pain Points & Triggers
  {
    key: 'primary_problems',
    section: 'pain_points',
    prompt: 'What are the primary problems your prospects face that you solve?',
    required: true,
    order: 7,
  },
  {
    key: 'triggers',
    section: 'pain_points',
    prompt: 'What triggers them to seek a solution? (e.g., "missed leads", "team growth", "new competitors")',
    required: false,
    order: 8,
  },
  {
    key: 'current_workarounds',
    section: 'pain_points',
    prompt: 'What workarounds are they likely using now? (e.g., "manual spreadsheets", "hiring more staff")',
    required: false,
    order: 9,
  },
  {
    key: 'cost_of_inaction',
    section: 'pain_points',
    prompt: 'What is the cost of NOT solving this problem? (e.g., "lost revenue", "wasted time", "missed opportunities")',
    required: false,
    order: 10,
  },

  // Section 3: Value Proposition
  {
    key: 'solution_description',
    section: 'value_prop',
    prompt: 'How do you solve their problem? Describe your solution in 1-2 sentences.',
    required: true,
    order: 11,
  },
  {
    key: 'differentiators',
    section: 'value_prop',
    prompt: 'What makes you different from alternatives? (e.g., "AI-powered", "industry-specific", "faster implementation")',
    required: true,
    order: 12,
  },
  {
    key: 'proof_points',
    section: 'value_prop',
    prompt: 'What proof points do you have? (e.g., "95% response rate", "case study with ABC Corp", "30-day ROI")',
    required: false,
    order: 13,
  },
  {
    key: 'outcomes',
    section: 'value_prop',
    prompt: 'What concrete outcomes can customers expect? (e.g., "3x more leads converted", "50% time saved")',
    required: false,
    order: 14,
  },

  // Section 4: Objection Handling
  {
    key: 'common_objections',
    section: 'objections',
    prompt: 'What are the most common objections you hear? (e.g., "too expensive", "we\'re too busy", "already have a solution")',
    required: true,
    order: 15,
  },
  {
    key: 'competitor_comparisons',
    section: 'objections',
    prompt: 'How should we position against competitors? What makes you better?',
    required: false,
    order: 16,
  },
  {
    key: 'pricing_objections',
    section: 'objections',
    prompt: 'How do you handle pricing objections? What is the ROI story?',
    required: false,
    order: 17,
  },

  // Section 5: Voice & Tone
  {
    key: 'tone',
    section: 'voice',
    prompt: 'How should emails sound? (e.g., "professional but friendly", "casual and direct", "formal and authoritative")',
    required: true,
    order: 18,
  },
  {
    key: 'phrases_to_use',
    section: 'voice',
    prompt: 'Are there specific phrases you like to use? (e.g., "happy to help", "quick question")',
    required: false,
    order: 19,
  },
  {
    key: 'phrases_to_avoid',
    section: 'voice',
    prompt: 'Any phrases to avoid? (e.g., "touching base", "circle back", "synergy")',
    required: false,
    order: 20,
  },
  {
    key: 'email_length',
    section: 'voice',
    prompt: 'How long should emails be? (e.g., "short - under 100 words", "medium - 100-200 words")',
    required: false,
    order: 21,
  },
  {
    key: 'signature_style',
    section: 'voice',
    prompt: 'How should we sign emails? (e.g., "First name only", "Full name with title", "Include phone number")',
    required: false,
    order: 22,
  },

  // Section 6: Timing Configuration
  {
    key: 'response_delay',
    section: 'timing',
    prompt: 'How quickly should we respond to replies? (e.g., "1-4 hours", "same day", "next business day")',
    required: false,
    order: 23,
  },
  {
    key: 'business_hours',
    section: 'timing',
    prompt: 'What business hours should we respect? (e.g., "9am-5pm Mountain Time", "24/7 is fine")',
    required: false,
    order: 24,
  },
  {
    key: 'followup_cadence',
    section: 'timing',
    prompt: 'How many days between follow-ups? (e.g., "3 days", "5-7 days")',
    required: false,
    order: 25,
  },
  {
    key: 'max_touches',
    section: 'timing',
    prompt: 'Maximum number of follow-ups before stopping? (e.g., "5 touches", "keep trying until they respond")',
    required: false,
    order: 26,
  },
];

/**
 * CampaignWizardService conducts conversational interviews to build complete sales playbooks.
 *
 * The wizard:
 * - Asks questions via Telegram
 * - Captures answers and stores state
 * - Supports skip, back, and resume
 * - Generates four output files: config.md, icp.md, playbook.md, sequence.md
 */
export class CampaignWizardService {
  private projectRoot: string;
  private telegramService: TelegramService;

  constructor(projectRoot?: string, telegramConfig?: TelegramConfig) {
    this.projectRoot = projectRoot ?? process.cwd();

    const config = telegramConfig ?? {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    };
    this.telegramService = new TelegramService(config);
  }

  /**
   * Get the path to the active wizards file.
   */
  private getWizardsPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'active_wizards.json');
  }

  /**
   * Get the path to a campaign folder.
   */
  private getCampaignFolder(tenantId: string, campaignName: string): string {
    const safeName = campaignName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return path.join(this.projectRoot, 'tenants', tenantId, 'operations', 'campaigns', safeName);
  }

  /**
   * Load active wizards data.
   */
  private async loadWizardsData(tenantId: string): Promise<ActiveWizardsData> {
    const filePath = this.getWizardsPath(tenantId);

    if (!fs.existsSync(filePath)) {
      const data: ActiveWizardsData = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        wizards: {},
      };

      const stateDir = path.dirname(filePath);
      await fs.promises.mkdir(stateDir, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      return data;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ActiveWizardsData;
  }

  /**
   * Save active wizards data.
   */
  private async saveWizardsData(tenantId: string, data: ActiveWizardsData): Promise<void> {
    const filePath = this.getWizardsPath(tenantId);
    data.lastUpdated = new Date().toISOString();
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Start a new wizard session.
   */
  async startWizard(tenantId: string, campaignName: string, chatId?: string): Promise<WizardState> {
    const data = await this.loadWizardsData(tenantId);
    const now = new Date().toISOString();

    const wizard: WizardState = {
      id: randomUUID(),
      tenant_id: tenantId,
      campaign_name: campaignName,
      status: 'in_progress',
      current_question_index: 0,
      answers: {},
      created_at: now,
      updated_at: now,
      chat_id: chatId,
    };

    data.wizards[wizard.id] = wizard;
    await this.saveWizardsData(tenantId, data);

    logger.info({ tenantId, wizardId: wizard.id, campaignName }, 'Campaign wizard started');

    return wizard;
  }

  /**
   * Get the current state of a wizard.
   */
  async getWizardState(tenantId: string, wizardId: string): Promise<WizardState | null> {
    const data = await this.loadWizardsData(tenantId);
    return data.wizards[wizardId] ?? null;
  }

  /**
   * Get the next question for a wizard.
   */
  async getNextQuestion(tenantId: string, wizardId: string): Promise<WizardQuestion | null> {
    const wizard = await this.getWizardState(tenantId, wizardId);

    if (!wizard || wizard.status !== 'in_progress') {
      return null;
    }

    if (wizard.current_question_index >= WIZARD_QUESTIONS.length) {
      return null;
    }

    return WIZARD_QUESTIONS[wizard.current_question_index];
  }

  /**
   * Process an answer from the user.
   */
  async processAnswer(tenantId: string, wizardId: string, answer: string): Promise<WizardState> {
    const data = await this.loadWizardsData(tenantId);
    const wizard = data.wizards[wizardId];

    if (!wizard || wizard.status !== 'in_progress') {
      throw new Error('Wizard not found or not in progress');
    }

    const trimmedAnswer = answer.trim().toLowerCase();

    // Handle "back" command
    if (trimmedAnswer === 'back') {
      if (wizard.current_question_index > 0) {
        wizard.current_question_index--;
        // Remove the answer for the question we're going back to
        const previousQuestion = WIZARD_QUESTIONS[wizard.current_question_index];
        delete wizard.answers[previousQuestion.key];
      }
      wizard.updated_at = new Date().toISOString();
      await this.saveWizardsData(tenantId, data);
      return wizard;
    }

    // Get current question
    const currentQuestion = WIZARD_QUESTIONS[wizard.current_question_index];

    if (!currentQuestion) {
      return wizard;
    }

    // Handle "skip" for optional fields
    if (trimmedAnswer === 'skip') {
      if (currentQuestion.required) {
        // Cannot skip required fields - keep the same question
        return wizard;
      }
      // Move to next question without storing answer
      wizard.current_question_index++;
      wizard.updated_at = new Date().toISOString();
      await this.saveWizardsData(tenantId, data);
      return wizard;
    }

    // Store the answer
    wizard.answers[currentQuestion.key] = answer.trim();
    wizard.current_question_index++;
    wizard.updated_at = new Date().toISOString();

    await this.saveWizardsData(tenantId, data);

    logger.debug(
      { tenantId, wizardId, question: currentQuestion.key, index: wizard.current_question_index },
      'Wizard answer processed'
    );

    return wizard;
  }

  /**
   * Format a question for Telegram.
   */
  formatQuestionMessage(question: WizardQuestion, currentIndex: number, totalQuestions: number): string {
    const sectionNames: Record<WizardSection, string> = {
      icp: 'ICP Definition',
      pain_points: 'Pain Points & Triggers',
      value_prop: 'Value Proposition',
      objections: 'Objection Handling',
      voice: 'Voice & Tone',
      timing: 'Timing Configuration',
    };

    const lines: string[] = [
      `<b>${sectionNames[question.section]}</b>`,
      `<i>Question ${currentIndex + 1} of ${totalQuestions}</i>`,
      '',
      question.prompt,
    ];

    if (question.help_text) {
      lines.push('');
      lines.push(`<i>${question.help_text}</i>`);
    }

    lines.push('');
    if (!question.required) {
      lines.push('Type <b>skip</b> to skip this question.');
    }
    lines.push('Type <b>back</b> to revise your previous answer.');

    return lines.join('\n');
  }

  /**
   * Send the next question via Telegram.
   */
  async sendNextQuestion(tenantId: string, wizardId: string, chatId: string): Promise<boolean> {
    const question = await this.getNextQuestion(tenantId, wizardId);

    if (!question) {
      return false;
    }

    const wizard = await this.getWizardState(tenantId, wizardId);
    if (!wizard) {
      return false;
    }

    const message = this.formatQuestionMessage(
      question,
      wizard.current_question_index,
      WIZARD_QUESTIONS.length
    );

    await this.telegramService.sendTextMessage(chatId, message);

    // Update wizard with chat_id if not set
    if (!wizard.chat_id) {
      const data = await this.loadWizardsData(tenantId);
      data.wizards[wizardId].chat_id = chatId;
      await this.saveWizardsData(tenantId, data);
    }

    return true;
  }

  /**
   * Get required fields that are missing.
   */
  private getMissingRequiredFields(answers: Record<string, string>): string[] {
    const requiredQuestions = WIZARD_QUESTIONS.filter((q) => q.required);
    return requiredQuestions.filter((q) => !answers[q.key]).map((q) => q.key);
  }

  /**
   * Complete the wizard and generate output files.
   */
  async completeWizard(tenantId: string, wizardId: string): Promise<void> {
    const data = await this.loadWizardsData(tenantId);
    const wizard = data.wizards[wizardId];

    if (!wizard) {
      throw new Error('Wizard not found');
    }

    // Validate required fields
    const missingFields = this.getMissingRequiredFields(wizard.answers);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Create campaign folder
    const campaignFolder = this.getCampaignFolder(tenantId, wizard.campaign_name);
    await fs.promises.mkdir(campaignFolder, { recursive: true });

    // Generate output files
    await this.generateConfigFile(campaignFolder, wizard);
    await this.generateIcpFile(campaignFolder, wizard);
    await this.generatePlaybookFile(campaignFolder, wizard);
    await this.generateSequenceFile(campaignFolder, wizard);

    // Also create targets.md and metrics.md for a complete campaign
    await this.generateTargetsFile(campaignFolder);
    await this.generateMetricsFile(campaignFolder);
    await this.generateLogFile(campaignFolder, wizard.campaign_name);

    // Mark wizard as complete
    wizard.status = 'completed';
    wizard.updated_at = new Date().toISOString();
    await this.saveWizardsData(tenantId, data);

    logger.info({ tenantId, wizardId, campaignName: wizard.campaign_name }, 'Campaign wizard completed');
  }

  /**
   * Generate config.md - Campaign metadata, timing settings, channel config.
   */
  private async generateConfigFile(campaignFolder: string, wizard: WizardState): Promise<void> {
    const now = new Date().toISOString();

    // Parse timing settings from answers
    const responseDelayMatch = wizard.answers.response_delay?.match(/(\d+)/);
    const followupCadenceMatch = wizard.answers.followup_cadence?.match(/(\d+)/);
    const maxTouchesMatch = wizard.answers.max_touches?.match(/(\d+)/);

    const config = {
      version: 1,
      id: randomUUID(),
      name: wizard.campaign_name,
      status: 'draft',
      created_at: now,
      lastUpdated: now,
      owner_phone: '',
      goal: wizard.answers.solution_description || 'Campaign created via wizard',
      audience: {
        description: wizard.answers.industry || '',
        industries: [wizard.answers.industry || ''],
        company_size: wizard.answers.company_size || '',
        locations: [wizard.answers.geographic_targeting || ''],
      },
      channels: {
        email: { enabled: true, provider: 'gmail' },
        linkedin: { enabled: false },
        sms: { enabled: false },
        calls: { enabled: false },
      },
      settings: {
        max_daily_outreach: 20,
        min_days_between_touches: followupCadenceMatch ? parseInt(followupCadenceMatch[1], 10) : 3,
        max_touches_per_target: maxTouchesMatch ? parseInt(maxTouchesMatch[1], 10) : 5,
        require_approval: true,
        approval_mode: 'batch',
        response_delay_min_hours: responseDelayMatch ? parseInt(responseDelayMatch[1], 10) : 1,
        response_delay_max_hours: responseDelayMatch ? parseInt(responseDelayMatch[1], 10) + 3 : 4,
        business_hours_only: !wizard.answers.business_hours?.toLowerCase().includes('24/7'),
        business_hours_start: '09:00',
        business_hours_end: '17:00',
        business_hours_timezone: 'America/Denver',
        response_mode: 'delayed',
      },
      metrics_snapshot: {
        total_targets: 0,
        by_stage: {
          identified: 0,
          researched: 0,
          contacted: 0,
          replied: 0,
          qualified: 0,
          booked: 0,
          won: 0,
          lost: 0,
        },
      },
    };

    const markdown = `# Campaign: ${wizard.campaign_name}

## Objective
${wizard.answers.solution_description || 'No objective defined'}

## Messaging Guidelines
- Personalize every message based on research
- Keep messages concise and value-focused
- Reference specific company news or achievements
- Tone: ${wizard.answers.tone || 'Professional but conversational'}

## Notes
Campaign created via wizard on ${now.split('T')[0]}
`;

    const content = `---json\n${JSON.stringify(config, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'config.md'), content, 'utf-8');
  }

  /**
   * Generate icp.md - Detailed ICP definition from Section 1.
   */
  private async generateIcpFile(campaignFolder: string, wizard: WizardState): Promise<void> {
    const now = new Date().toISOString();

    const icpData = {
      version: 1,
      lastUpdated: now,
      icp_definition: {
        industry: wizard.answers.industry || '',
        company_size: wizard.answers.company_size || '',
        geographic_targeting: wizard.answers.geographic_targeting || '',
        job_titles: wizard.answers.job_titles?.split(',').map((t) => t.trim()) || [],
        buying_signals: wizard.answers.buying_signals?.split(',').map((s) => s.trim()) || [],
        disqualifiers: wizard.answers.disqualifiers?.split(',').map((d) => d.trim()) || [],
      },
    };

    const markdown = `# Ideal Customer Profile (ICP)

## Target Industry
${wizard.answers.industry || 'Not specified'}

## Company Size
${wizard.answers.company_size || 'Not specified'}

## Geographic Targeting
${wizard.answers.geographic_targeting || 'Not specified'}

## Job Titles
${wizard.answers.job_titles || 'Not specified'}

## Buying Signals
Signs that indicate a prospect might need our solution:
${wizard.answers.buying_signals || '- Not specified'}

## Disqualifiers
What makes someone NOT a good fit:
${wizard.answers.disqualifiers || '- Not specified'}
`;

    const content = `---json\n${JSON.stringify(icpData, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'icp.md'), content, 'utf-8');
  }

  /**
   * Generate playbook.md - Pain points, value prop, objections, voice from Sections 2-5.
   */
  private async generatePlaybookFile(campaignFolder: string, wizard: WizardState): Promise<void> {
    const now = new Date().toISOString();

    const playbookData = {
      version: 1,
      lastUpdated: now,
      pain_points: {
        primary_problems: wizard.answers.primary_problems || '',
        triggers: wizard.answers.triggers || '',
        current_workarounds: wizard.answers.current_workarounds || '',
        cost_of_inaction: wizard.answers.cost_of_inaction || '',
      },
      value_proposition: {
        solution_description: wizard.answers.solution_description || '',
        differentiators: wizard.answers.differentiators || '',
        proof_points: wizard.answers.proof_points || '',
        outcomes: wizard.answers.outcomes || '',
      },
      objection_handling: {
        common_objections: wizard.answers.common_objections || '',
        competitor_comparisons: wizard.answers.competitor_comparisons || '',
        pricing_objections: wizard.answers.pricing_objections || '',
      },
      voice_and_tone: {
        tone: wizard.answers.tone || '',
        phrases_to_use: wizard.answers.phrases_to_use?.split(',').map((p) => p.trim()) || [],
        phrases_to_avoid: wizard.answers.phrases_to_avoid?.split(',').map((p) => p.trim()) || [],
        email_length: wizard.answers.email_length || '',
        signature_style: wizard.answers.signature_style || '',
      },
    };

    const markdown = `# Sales Playbook

## Pain Points & Triggers

### Primary Problems We Solve
${wizard.answers.primary_problems || 'Not specified'}

### What Triggers Them to Seek a Solution
${wizard.answers.triggers || 'Not specified'}

### Current Workarounds
${wizard.answers.current_workarounds || 'Not specified'}

### Cost of Not Solving
${wizard.answers.cost_of_inaction || 'Not specified'}

---

## Value Proposition

### Our Solution
${wizard.answers.solution_description || 'Not specified'}

### Key Differentiators
${wizard.answers.differentiators || 'Not specified'}

### Proof Points
${wizard.answers.proof_points || 'Not specified'}

### Expected Outcomes
${wizard.answers.outcomes || 'Not specified'}

---

## Objection Handling

### Common Objections
${wizard.answers.common_objections || 'Not specified'}

### Competitor Comparisons
${wizard.answers.competitor_comparisons || 'Not specified'}

### Pricing Objections
${wizard.answers.pricing_objections || 'Not specified'}

---

## Voice & Tone

### Tone
${wizard.answers.tone || 'Professional but conversational'}

### Phrases to Use
${wizard.answers.phrases_to_use || 'Not specified'}

### Phrases to Avoid
${wizard.answers.phrases_to_avoid || 'Not specified'}

### Email Length
${wizard.answers.email_length || 'Concise, under 150 words'}

### Signature Style
${wizard.answers.signature_style || 'First name with company'}
`;

    const content = `---json\n${JSON.stringify(playbookData, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'playbook.md'), content, 'utf-8');
  }

  /**
   * Generate sequence.md - Email sequence with timing from Section 6.
   */
  private async generateSequenceFile(campaignFolder: string, wizard: WizardState): Promise<void> {
    const now = new Date().toISOString();

    const followupDays = wizard.answers.followup_cadence?.match(/(\d+)/)?.[1] || '3';
    const maxTouches = wizard.answers.max_touches?.match(/(\d+)/)?.[1] || '5';

    const sequenceData = {
      version: 1,
      lastUpdated: now,
      timing: {
        response_delay: wizard.answers.response_delay || '1-4 hours',
        business_hours: wizard.answers.business_hours || '9am-5pm Mountain Time',
        followup_cadence_days: parseInt(followupDays, 10),
        max_touches: parseInt(maxTouches, 10),
      },
      ai_instructions: {
        mode: 'autonomous',
        guidelines: [
          'Personalize every message based on research',
          'Reference specific company news or achievements',
          `Keep messages ${wizard.answers.email_length || 'under 150 words for email'}`,
          `Wait at least ${followupDays} days between touches`,
          'Vary channels if no response',
          `Tone: ${wizard.answers.tone || 'professional but conversational'}`,
        ],
        forbidden_phrases: wizard.answers.phrases_to_avoid?.split(',').map((p) => p.trim()) || [
          'touching base',
          'just checking in',
          'circle back',
        ],
      },
    };

    const markdown = `# Sequence Strategy

## Timing Configuration
- **Response Delay:** ${wizard.answers.response_delay || '1-4 hours'}
- **Business Hours:** ${wizard.answers.business_hours || '9am-5pm Mountain Time'}
- **Follow-up Cadence:** Every ${followupDays} days
- **Max Touches:** ${maxTouches}

## AI Decision Guidelines
The AI should analyze each target's context and decide the best next action.

### Tone & Style
- ${wizard.answers.tone || 'Professional but conversational'}
- ${wizard.answers.email_length || 'Keep emails concise'}

### Forbidden Phrases
${wizard.answers.phrases_to_avoid || '- touching base\n- just checking in\n- circle back'}

## Channel Priority
1. Email (primary)
2. LinkedIn (if connected or can connect)
3. SMS (only for warm leads with phone)
4. Calls (only for qualified leads)
`;

    const content = `---json\n${JSON.stringify(sequenceData, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'sequence.md'), content, 'utf-8');
  }

  /**
   * Generate targets.md - Empty target references.
   */
  private async generateTargetsFile(campaignFolder: string): Promise<void> {
    const now = new Date().toISOString();

    const targetsData = {
      version: 2,
      lastUpdated: now,
      target_references: [],
    };

    const markdown = `# Campaign Targets

## Stage Definitions
- **Identified**: Added to campaign, not yet researched
- **Researched**: Background research completed
- **Contacted**: At least one outreach attempt made
- **Replied**: Received any response (positive or negative)
- **Qualified**: Confirmed interest/fit
- **Booked**: Meeting scheduled
- **Won**: Deal closed
- **Lost**: Declined or unsubscribed
`;

    const content = `---json\n${JSON.stringify(targetsData, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'targets.md'), content, 'utf-8');
  }

  /**
   * Generate metrics.md - Initial metrics file.
   */
  private async generateMetricsFile(campaignFolder: string): Promise<void> {
    const now = new Date().toISOString();

    const metricsData = {
      version: 1,
      lastUpdated: now,
      summary: {
        total_targets: 0,
        total_touches: 0,
        total_replies: 0,
        meetings_booked: 0,
        deals_won: 0,
        deals_lost: 0,
      },
      by_stage: {
        identified: 0,
        researched: 0,
        contacted: 0,
        replied: 0,
        qualified: 0,
        booked: 0,
        won: 0,
        lost: 0,
      },
      by_channel: {
        email: { sent: 0, opened: 0, replied: 0 },
        linkedin: { sent: 0, accepted: 0, replied: 0 },
        sms: { sent: 0, replied: 0 },
        calls: { made: 0, answered: 0, booked: 0 },
      },
      daily_stats: [],
    };

    const markdown = `# Campaign Metrics

## Performance Summary
Last updated: ${now}
`;

    const content = `---json\n${JSON.stringify(metricsData, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'metrics.md'), content, 'utf-8');
  }

  /**
   * Generate log.md - Initial log file.
   */
  private async generateLogFile(campaignFolder: string, campaignName: string): Promise<void> {
    const now = new Date().toISOString();
    const dateStr = now.split('T')[0];
    const timeStr = now.split('T')[1].split('.')[0];

    const logData = {
      version: 1,
      lastUpdated: now,
    };

    const markdown = `# Campaign Activity Log

## ${dateStr}

### ${timeStr} [CAMPAIGN] Campaign created via wizard
- Name: ${campaignName}
- Status: draft

`;

    const content = `---json\n${JSON.stringify(logData, null, 2)}\n---\n${markdown}`;
    await fs.promises.writeFile(path.join(campaignFolder, 'log.md'), content, 'utf-8');
  }

  /**
   * Cancel a wizard.
   */
  async cancelWizard(tenantId: string, wizardId: string): Promise<void> {
    const data = await this.loadWizardsData(tenantId);
    const wizard = data.wizards[wizardId];

    if (wizard) {
      wizard.status = 'cancelled';
      wizard.updated_at = new Date().toISOString();
      await this.saveWizardsData(tenantId, data);

      logger.info({ tenantId, wizardId }, 'Campaign wizard cancelled');
    }
  }

  /**
   * Expire old wizards (older than 7 days).
   */
  async expireOldWizards(tenantId: string): Promise<number> {
    const data = await this.loadWizardsData(tenantId);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let expiredCount = 0;

    for (const wizardId of Object.keys(data.wizards)) {
      const wizard = data.wizards[wizardId];

      if (wizard.status === 'in_progress') {
        const updatedAt = new Date(wizard.updated_at).getTime();

        if (updatedAt < sevenDaysAgo) {
          wizard.status = 'expired';
          wizard.updated_at = new Date().toISOString();
          expiredCount++;
        }
      }
    }

    if (expiredCount > 0) {
      await this.saveWizardsData(tenantId, data);
      logger.info({ tenantId, expiredCount }, 'Expired old wizards');
    }

    return expiredCount;
  }

  /**
   * List active wizards for a tenant.
   */
  async listActiveWizards(tenantId: string): Promise<WizardState[]> {
    const data = await this.loadWizardsData(tenantId);
    return Object.values(data.wizards).filter((w) => w.status === 'in_progress');
  }

  /**
   * Get progress summary for a wizard.
   */
  getProgressSummary(wizard: WizardState): string {
    const totalQuestions = WIZARD_QUESTIONS.length;
    const answered = wizard.current_question_index;
    const percentage = Math.round((answered / totalQuestions) * 100);

    // Determine current section
    const currentQuestion = WIZARD_QUESTIONS[wizard.current_question_index];
    const sectionName = currentQuestion
      ? {
          icp: 'ICP Definition',
          pain_points: 'Pain Points',
          value_prop: 'Value Proposition',
          objections: 'Objection Handling',
          voice: 'Voice & Tone',
          timing: 'Timing',
        }[currentQuestion.section]
      : 'Complete';

    return `Progress: ${answered}/${totalQuestions} (${percentage}%) - ${sectionName}`;
  }
}
