/**
 * CampaignWizardService Tests
 *
 * Tests for the campaign setup wizard that conducts conversational interviews
 * to build complete sales playbooks via Telegram.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CampaignWizardService,
  WizardState,
  WizardSection,
  WizardQuestion,
} from '../campaignWizardService.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock TelegramService
const mockSendTextMessage = jest.fn().mockResolvedValue('12345');

jest.mock('../messaging/telegram.js', () => ({
  TelegramService: jest.fn().mockImplementation(() => ({
    sendTextMessage: mockSendTextMessage,
  })),
}));

describe('CampaignWizardService', () => {
  let service: CampaignWizardService;
  const testProjectRoot = path.join(process.cwd(), 'test-temp-wizard');
  const testTenantId = 'test-tenant';
  const stateFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'state');
  const campaignsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'operations', 'campaigns');

  beforeAll(async () => {
    await fs.promises.mkdir(stateFolder, { recursive: true });
    await fs.promises.mkdir(campaignsFolder, { recursive: true });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new CampaignWizardService(testProjectRoot, { botToken: 'test-bot-token' });

    // Clean up state files
    const wizardsPath = path.join(stateFolder, 'active_wizards.json');
    if (fs.existsSync(wizardsPath)) {
      await fs.promises.unlink(wizardsPath);
    }

    // Clean up campaign folders
    if (fs.existsSync(campaignsFolder)) {
      const entries = await fs.promises.readdir(campaignsFolder, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await fs.promises.rm(path.join(campaignsFolder, entry.name), { recursive: true });
        }
      }
    }
  });

  afterAll(async () => {
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  describe('ICP Definition capture', () => {
    it('captures ICP definition fields through wizard flow', async () => {
      // Start wizard
      const wizard = await service.startWizard(testTenantId, 'icp-test-campaign');
      expect(wizard).toBeDefined();
      expect(wizard.id).toBeDefined();
      expect(wizard.status).toBe('in_progress');

      // Answer ICP questions
      const icpAnswers = {
        industry: 'Real estate agents',
        company_size: 'Solo practitioners and small teams (2-10 people)',
        geographic_targeting: 'Salt Lake City metro area',
        job_titles: 'Broker, Agent, Realtor',
        buying_signals: 'Recently posted about lead follow-up challenges, No CRM mentioned',
        disqualifiers: 'Large brokerages with dedicated IT teams, Already using automation',
      };

      // Process each ICP answer
      let currentWizard = wizard;
      const icpQuestionKeys = ['industry', 'company_size', 'geographic_targeting', 'job_titles', 'buying_signals', 'disqualifiers'];

      for (const key of icpQuestionKeys) {
        const question = await service.getNextQuestion(testTenantId, currentWizard.id);
        if (!question) break;

        // Only process ICP section questions
        if (question.section !== 'icp') break;

        const answer = icpAnswers[key as keyof typeof icpAnswers] || 'Test answer';
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, answer);
      }

      // Verify ICP data was captured
      const state = await service.getWizardState(testTenantId, currentWizard.id);
      expect(state).not.toBeNull();
      expect(state!.answers.industry).toBe(icpAnswers.industry);
      expect(state!.answers.company_size).toBe(icpAnswers.company_size);
      expect(state!.answers.geographic_targeting).toBe(icpAnswers.geographic_targeting);
    });
  });

  describe('Value proposition and objections capture', () => {
    it('captures value proposition and objection handling through wizard flow', async () => {
      const wizard = await service.startWizard(testTenantId, 'value-test-campaign');

      // Skip to value prop section by answering ICP and pain points
      let currentWizard = wizard;

      // Answer all questions until we reach value prop section
      let question = await service.getNextQuestion(testTenantId, currentWizard.id);
      while (question && question.section !== 'value_prop') {
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, 'Test answer for ' + question.key);
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
      }

      // Now answer value prop questions
      const valuePropAnswers = {
        solution_description: 'We provide AI-powered lead follow-up that responds to every lead in under 5 minutes',
        differentiators: 'Unlike chatbots, our AI is trained specifically for real estate conversations',
        proof_points: '95% response rate, 3x more showings booked, Case study with ABC Realty',
        outcomes: 'More leads converted, less time on follow-up, never miss a hot lead',
      };

      for (const [key, answer] of Object.entries(valuePropAnswers)) {
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
        if (!question || question.section !== 'value_prop') break;
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, answer);
      }

      // Continue to objection handling
      const objectionAnswers = {
        common_objections: "It's too expensive, I don't trust AI, I prefer personal touch",
        competitor_comparisons: 'We focus on real estate specifically, unlike generic tools',
        pricing_objections: 'ROI typically within 30 days based on leads converted',
      };

      for (const [key, answer] of Object.entries(objectionAnswers)) {
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
        if (!question || question.section !== 'objections') break;
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, answer);
      }

      // Verify value prop data was captured
      const state = await service.getWizardState(testTenantId, currentWizard.id);
      expect(state!.answers.solution_description).toContain('AI-powered');
      expect(state!.answers.differentiators).toContain('real estate');
    });
  });

  describe('Voice/tone preferences capture', () => {
    it('captures voice and tone preferences through wizard flow', async () => {
      const wizard = await service.startWizard(testTenantId, 'voice-test-campaign');

      // Skip to voice section
      let currentWizard = wizard;
      let question = await service.getNextQuestion(testTenantId, currentWizard.id);

      while (question && question.section !== 'voice') {
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, 'Test answer');
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
      }

      // Answer voice questions
      const voiceAnswers = {
        tone: 'Professional but friendly, like a helpful colleague',
        phrases_to_use: 'Looking forward to connecting, Happy to help, Quick question',
        phrases_to_avoid: 'Touching base, Circle back, Synergy',
        email_length: 'Short and punchy, under 100 words',
        signature_style: 'First name only with company',
      };

      for (const [key, answer] of Object.entries(voiceAnswers)) {
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
        if (!question || question.section !== 'voice') break;
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, answer);
      }

      // Verify voice data was captured
      const state = await service.getWizardState(testTenantId, currentWizard.id);
      expect(state!.answers.tone).toContain('Professional');
      expect(state!.answers.phrases_to_avoid).toContain('Touching base');
    });
  });

  describe('Output file generation', () => {
    it('generates four output files (config.md, icp.md, playbook.md, sequence.md)', async () => {
      const wizard = await service.startWizard(testTenantId, 'output-test-campaign');

      // Complete wizard with all answers
      let currentWizard = wizard;
      let question = await service.getNextQuestion(testTenantId, currentWizard.id);

      while (question) {
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, `Test answer for ${question.key}`);
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
      }

      // Complete the wizard to generate files
      await service.completeWizard(testTenantId, currentWizard.id);

      // Verify output files exist
      const campaignFolder = path.join(campaignsFolder, 'output-test-campaign');

      expect(fs.existsSync(path.join(campaignFolder, 'config.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'icp.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'playbook.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'sequence.md'))).toBe(true);
    });

    it('generates valid output files with captured information', async () => {
      const wizard = await service.startWizard(testTenantId, 'content-test-campaign');

      // Set specific answers for verification
      let currentWizard = wizard;
      let question = await service.getNextQuestion(testTenantId, currentWizard.id);

      // Answer with recognizable content
      const testIndustry = 'UNIQUE_INDUSTRY_FOR_TEST';
      let firstQuestion = true;

      while (question) {
        const answer = firstQuestion ? testIndustry : `Test answer for ${question.key}`;
        firstQuestion = false;
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, answer);
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
      }

      await service.completeWizard(testTenantId, currentWizard.id);

      // Read and verify icp.md contains the captured industry
      const icpPath = path.join(campaignsFolder, 'content-test-campaign', 'icp.md');
      const icpContent = await fs.promises.readFile(icpPath, 'utf-8');
      expect(icpContent).toContain(testIndustry);
    });
  });

  describe('Required field validation', () => {
    it('validates required fields before completion', async () => {
      const wizard = await service.startWizard(testTenantId, 'validation-test-campaign');

      // Try to complete without answering required questions
      await expect(service.completeWizard(testTenantId, wizard.id)).rejects.toThrow(/required/i);
    });

    it('allows skip for optional fields', async () => {
      const wizard = await service.startWizard(testTenantId, 'skip-test-campaign');

      // Answer required questions only
      let currentWizard = wizard;
      let question = await service.getNextQuestion(testTenantId, currentWizard.id);

      while (question) {
        // Skip optional fields, answer required ones
        const answer = question.required ? 'Required answer' : 'skip';
        currentWizard = await service.processAnswer(testTenantId, currentWizard.id, answer);
        question = await service.getNextQuestion(testTenantId, currentWizard.id);
      }

      // Should be able to complete with optional fields skipped
      await service.completeWizard(testTenantId, currentWizard.id);

      // Verify wizard completed
      const state = await service.getWizardState(testTenantId, currentWizard.id);
      expect(state!.status).toBe('completed');
    });
  });

  describe('Wizard resume capability', () => {
    it('persists wizard state after each answer', async () => {
      const wizard = await service.startWizard(testTenantId, 'persist-test-campaign');

      // Answer first question
      await service.processAnswer(testTenantId, wizard.id, 'First answer');

      // Create new service instance to simulate reconnect
      const newService = new CampaignWizardService(testProjectRoot, { botToken: 'test-bot-token' });

      // Verify state is persisted
      const resumedState = await newService.getWizardState(testTenantId, wizard.id);
      expect(resumedState).not.toBeNull();
      expect(resumedState!.answers).toBeDefined();
    });

    it('resumes from last question on reconnect', async () => {
      const wizard = await service.startWizard(testTenantId, 'resume-test-campaign');

      // Answer a few questions
      let currentWizard = wizard;
      for (let i = 0; i < 3; i++) {
        const question = await service.getNextQuestion(testTenantId, currentWizard.id);
        if (question) {
          currentWizard = await service.processAnswer(testTenantId, currentWizard.id, `Answer ${i}`);
        }
      }

      // Get current question index
      const beforeState = await service.getWizardState(testTenantId, currentWizard.id);
      const currentIndex = beforeState!.current_question_index;

      // Simulate reconnect with new service
      const newService = new CampaignWizardService(testProjectRoot, { botToken: 'test-bot-token' });

      // Resume and get next question
      const nextQuestion = await newService.getNextQuestion(testTenantId, currentWizard.id);

      // Verify we resumed at the correct position
      const afterState = await newService.getWizardState(testTenantId, currentWizard.id);
      expect(afterState!.current_question_index).toBe(currentIndex);
    });

    it('allows back navigation to revise previous answer', async () => {
      const wizard = await service.startWizard(testTenantId, 'back-test-campaign');

      // Answer first two questions
      let currentWizard = await service.processAnswer(testTenantId, wizard.id, 'First answer');
      currentWizard = await service.processAnswer(testTenantId, currentWizard.id, 'Second answer');

      // Go back
      currentWizard = await service.processAnswer(testTenantId, currentWizard.id, 'back');

      // Verify we went back to previous question
      const state = await service.getWizardState(testTenantId, currentWizard.id);
      // The current question index should have decreased
      expect(state!.current_question_index).toBeLessThan(2);
    });

    it('expires incomplete wizards after 7 days', async () => {
      const wizard = await service.startWizard(testTenantId, 'expire-test-campaign');

      // Manually set wizard created_at to 8 days ago
      const wizardsPath = path.join(stateFolder, 'active_wizards.json');
      const data = JSON.parse(await fs.promises.readFile(wizardsPath, 'utf-8'));

      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      data.wizards[wizard.id].created_at = eightDaysAgo;
      data.wizards[wizard.id].updated_at = eightDaysAgo;

      await fs.promises.writeFile(wizardsPath, JSON.stringify(data, null, 2));

      // Run expiration cleanup
      await service.expireOldWizards(testTenantId);

      // Verify wizard is expired
      const state = await service.getWizardState(testTenantId, wizard.id);
      expect(state!.status).toBe('expired');
    });
  });
});
