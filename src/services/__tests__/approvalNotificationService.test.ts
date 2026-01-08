/**
 * ApprovalNotificationService Tests
 *
 * Tests for Telegram approval notifications formatting and sending.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ApprovalNotificationService, ApprovalType } from '../approvalNotificationService.js';
import { ProspectData } from '../prospectService.js';
import { CampaignConfig } from '../campaignService.js';
import { QueuedAction } from '../approvalQueueService.js';

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

describe('ApprovalNotificationService', () => {
  let service: ApprovalNotificationService;
  const testProjectRoot = path.join(process.cwd(), 'test-temp-notifications');
  const testTenantId = 'test-tenant';
  const stateFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'state');

  const mockProspect: ProspectData = {
    slug: 'john-smith',
    frontmatter: {
      name: 'John Smith',
      company: 'ABC Realty',
      title: 'Broker/Owner',
      email: 'john@abcrealty.com',
      phone: '801-555-1234',
      source: 'google_maps',
      source_query: 'real estate agents Salt Lake City',
      stage: 'identified',
      created_at: '2026-01-07T10:00:00Z',
      updated_at: '2026-01-07T10:00:00Z',
    },
    body: '',
    businessContext: '15-year veteran broker in Salt Lake City. Runs a 4-person team.',
    researchNotes: 'Recently posted about struggling with lead follow-up.',
    personalizationHooks: 'Reference their Sugar House specialty.',
  };

  const mockCampaign: Partial<CampaignConfig> = {
    id: 'campaign-123',
    name: 'ProxyStaff Outbound',
    owner_phone: '+18015551234',
    goal: 'Book discovery calls with real estate agents',
    audience: {
      description: 'Real estate agents in Utah',
      industries: ['Real Estate'],
      company_size: 'small',
      locations: ['Salt Lake City', 'Utah'],
    },
  };

  const mockEmailAction: Partial<QueuedAction> = {
    id: 'action-456',
    campaign_id: 'campaign-123',
    campaign_name: 'ProxyStaff Outbound',
    target_id: 'target-789',
    target_name: 'John Smith',
    target_email: 'john@abcrealty.com',
    action_type: 'send_email',
    channel: 'email',
    subject: 'Quick question about your Sugar House listings',
    body: 'Hi John,\n\nI noticed you specialize in Sugar House properties. I work with real estate agents to automate their lead follow-up...\n\nWould you be open to a quick call this week?\n\nBest,\nAnden',
    reasoning: 'Personalized based on their specialty and recent posts about follow-up challenges.',
  };

  beforeAll(async () => {
    await fs.promises.mkdir(stateFolder, { recursive: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApprovalNotificationService(testProjectRoot, {
      botToken: 'test-bot-token',
    });
  });

  afterAll(async () => {
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  describe('formatApprovalMessage', () => {
    it('formats NEW_PROSPECT notification with all prospect context', () => {
      const message = service.formatApprovalMessage('NEW_PROSPECT', {
        prospect: mockProspect,
        campaign: mockCampaign as CampaignConfig,
      });

      // Check for key prospect information
      expect(message).toContain('John Smith');
      expect(message).toContain('ABC Realty');
      expect(message).toContain('Broker/Owner');
      expect(message).toContain('google_maps');
      // Check for ICP match explanation
      expect(message).toContain('15-year veteran broker');
      // Check for approve/reject prompt
      expect(message).toContain('approve');
      expect(message).toContain('reject');
    });

    it('formats EMAIL_READY notification with full email context', () => {
      const message = service.formatApprovalMessage('EMAIL_READY', {
        action: mockEmailAction as QueuedAction,
        prospect: mockProspect,
        campaign: mockCampaign as CampaignConfig,
      });

      // Check for recipient context
      expect(message).toContain('John Smith');
      expect(message).toContain('john@abcrealty.com');
      // Check for email subject
      expect(message).toContain('Quick question about your Sugar House listings');
      // Check for email body
      expect(message).toContain('I noticed you specialize in Sugar House');
      // Check for personalization notes
      expect(message).toContain('Personalized based on their specialty');
      // Check for approve/reject prompt
      expect(message).toContain('approve');
      expect(message).toContain('reject');
    });

    it('uses Telegram HTML formatting', () => {
      const message = service.formatApprovalMessage('NEW_PROSPECT', {
        prospect: mockProspect,
        campaign: mockCampaign as CampaignConfig,
      });

      // Should contain HTML tags for formatting
      expect(message).toMatch(/<b>.*<\/b>/); // Bold
    });
  });

  describe('notifyNewProspect', () => {
    it('sends NEW_PROSPECT notification via Telegram', async () => {
      const result = await service.notifyNewProspect(
        testTenantId,
        mockProspect,
        mockCampaign as CampaignConfig,
        '+18015551234'
      );

      expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
      expect(mockSendTextMessage).toHaveBeenCalledWith(
        '+18015551234',
        expect.stringContaining('John Smith')
      );
      expect(result.messageId).toBe('12345');
      expect(result.sentAt).toBeDefined();
    });

    it('includes prospect business context in notification', async () => {
      await service.notifyNewProspect(
        testTenantId,
        mockProspect,
        mockCampaign as CampaignConfig,
        '+18015551234'
      );

      const sentMessage = mockSendTextMessage.mock.calls[0][1];
      expect(sentMessage).toContain('15-year veteran broker');
    });
  });

  describe('notifyEmailReady', () => {
    it('sends EMAIL_READY notification via Telegram', async () => {
      const result = await service.notifyEmailReady(
        testTenantId,
        mockEmailAction as QueuedAction,
        mockProspect,
        mockCampaign as CampaignConfig,
        '+18015551234'
      );

      expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
      expect(result.messageId).toBe('12345');
      expect(result.sentAt).toBeDefined();
    });

    it('includes full email body in notification', async () => {
      await service.notifyEmailReady(
        testTenantId,
        mockEmailAction as QueuedAction,
        mockProspect,
        mockCampaign as CampaignConfig,
        '+18015551234'
      );

      const sentMessage = mockSendTextMessage.mock.calls[0][1];
      expect(sentMessage).toContain('Hi John');
      expect(sentMessage).toContain('Sugar House properties');
    });
  });

  describe('parseApprovalReply', () => {
    it('parses approval intent from reply message', () => {
      const approvalPhrases = ['yes', 'approve', 'approved', 'ok', 'looks good', 'send it'];

      for (const phrase of approvalPhrases) {
        const result = service.parseApprovalReply(phrase);
        expect(result.approved).toBe(true);
        expect(result.rejected).toBe(false);
      }
    });

    it('parses rejection intent from reply message', () => {
      const rejectionPhrases = ['no', 'reject', 'rejected', 'skip', 'not now', 'cancel'];

      for (const phrase of rejectionPhrases) {
        const result = service.parseApprovalReply(phrase);
        expect(result.approved).toBe(false);
        expect(result.rejected).toBe(true);
      }
    });

    it('returns ambiguous for unclear messages', () => {
      const ambiguousPhrases = ['maybe', 'let me think', 'hmm', 'what do you think'];

      for (const phrase of ambiguousPhrases) {
        const result = service.parseApprovalReply(phrase);
        expect(result.approved).toBe(false);
        expect(result.rejected).toBe(false);
        expect(result.ambiguous).toBe(true);
      }
    });

    it('extracts target name reference from reply', () => {
      const result = service.parseApprovalReply('approve john smith');
      expect(result.approved).toBe(true);
      expect(result.targetReference).toBe('john smith');
    });
  });
});
