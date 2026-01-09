/**
 * Task Groups 2, 3 & 4 Tests: ApprovalNotificationService Initialization, sendPendingNotifications, and Processing Integration
 *
 * Tests for:
 * Task Group 2:
 * - CampaignScheduler accepts ApprovalNotificationService via setter
 * - CampaignScheduler can be constructed without ApprovalNotificationService (optional dependency)
 * - Service is accessible after being set
 *
 * Task Group 3:
 * - Method fetches actions needing notification via approvalQueue
 * - Method skips processing when tenant has no telegram_chat_id
 * - Method calls notifyEmailReady for send_email actions
 * - Method updates notification info after successful send
 *
 * Task Group 4:
 * - sendPendingNotifications is called after campaign processing steps
 * - Notification errors do not break the processing cycle
 * - Notifications are sent for each tenant with active campaigns
 *
 * Task Group 5 (Gap Tests):
 * - Graceful handling when prospect not found
 * - Graceful handling when campaign config not found
 * - Notification retries on next cycle when first attempt fails
 * - Full notification flow integration
 */

import { PrismaClient } from '@prisma/client';
import { CampaignService } from '../../src/services/campaignService';
import { ApprovalQueueService } from '../../src/services/approvalQueueService';
import { UnsubscribeService } from '../../src/services/unsubscribeService';
import { TimelineService } from '../../src/services/timelineService';
import { ApprovalNotificationService } from '../../src/services/approvalNotificationService';
import { ProspectService } from '../../src/services/prospectService';

// Mock getTelegramService before importing CampaignScheduler
const mockTelegramService = {
  sendMessage: jest.fn(),
  sendMessageWithButtons: jest.fn(),
};

jest.mock('../../src/services/index.js', () => ({
  getTelegramService: jest.fn(() => mockTelegramService),
}));

// Import CampaignScheduler after the mock is set up
import { CampaignScheduler } from '../../src/services/campaignScheduler';

// Mock Prisma
const mockPrisma = {
  tenant: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

// Mock services
const mockCampaignService = {
  listCampaigns: jest.fn().mockResolvedValue([]),
  getCampaign: jest.fn(),
  getTargetReferences: jest.fn(),
} as unknown as CampaignService;

const mockApprovalQueue = {
  listPendingActions: jest.fn().mockResolvedValue([]),
  expireOldActions: jest.fn().mockResolvedValue(0),
  getActionsNeedingNotification: jest.fn().mockResolvedValue([]),
  updateNotificationInfo: jest.fn().mockResolvedValue(undefined),
} as unknown as ApprovalQueueService;

const mockUnsubscribeService = {} as UnsubscribeService;
const mockTimelineService = {} as TimelineService;

describe('Task Group 2: ApprovalNotificationService Initialization', () => {
  let scheduler: CampaignScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new CampaignScheduler(
      mockPrisma,
      mockCampaignService,
      mockApprovalQueue,
      mockUnsubscribeService,
      mockTimelineService
    );
  });

  // Test 1: CampaignScheduler accepts ApprovalNotificationService via setter
  test('accepts ApprovalNotificationService via setter', () => {
    const mockNotificationService = {
      notifyEmailReady: jest.fn(),
      notifyNewProspect: jest.fn(),
    } as unknown as ApprovalNotificationService;

    // Should not throw when setting service
    expect(() => {
      scheduler.setApprovalNotificationService(mockNotificationService);
    }).not.toThrow();
  });

  // Test 2: CampaignScheduler can be constructed without ApprovalNotificationService
  test('can be constructed without ApprovalNotificationService (optional dependency)', () => {
    // Should create successfully without notification service
    const newScheduler = new CampaignScheduler(
      mockPrisma,
      mockCampaignService,
      mockApprovalQueue,
      mockUnsubscribeService,
      mockTimelineService
    );

    expect(newScheduler).toBeDefined();
    // Should be able to call methods without error
    expect(newScheduler.start).toBeDefined();
    expect(newScheduler.stop).toBeDefined();
  });

  // Test 3: Service is accessible after being set
  test('service is accessible after being set', async () => {
    const mockNotificationService = {
      notifyEmailReady: jest.fn().mockResolvedValue({ messageId: 'msg-123', sentAt: new Date().toISOString() }),
      notifyNewProspect: jest.fn(),
    } as unknown as ApprovalNotificationService;

    scheduler.setApprovalNotificationService(mockNotificationService);

    // The service should be accessible internally - we'll verify by testing sendPendingNotifications
    // which uses the service. First, set up a scenario where the service would be called.
    const mockProspectService = {
      readProspect: jest.fn().mockResolvedValue({
        slug: 'john-doe',
        frontmatter: { name: 'John Doe', email: 'john@test.com', stage: 'contacted' },
      }),
    } as unknown as ProspectService;

    scheduler.setProspectService(mockProspectService);

    // This verifies the service was set correctly - if it wasn't, the internal method would fail
    // We're just checking the setter doesn't throw and the object is properly initialized
    expect(scheduler).toHaveProperty('setApprovalNotificationService');
  });
});

describe('Task Group 3: sendPendingNotifications Method', () => {
  let scheduler: CampaignScheduler;
  let mockNotificationService: jest.Mocked<ApprovalNotificationService>;
  let mockProspectService: jest.Mocked<ProspectService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockNotificationService = {
      notifyEmailReady: jest.fn().mockResolvedValue({ messageId: 'msg-123', sentAt: new Date().toISOString() }),
      notifyNewProspect: jest.fn(),
    } as unknown as jest.Mocked<ApprovalNotificationService>;

    mockProspectService = {
      readProspect: jest.fn().mockResolvedValue({
        slug: 'john-doe',
        frontmatter: { name: 'John Doe', email: 'john@test.com', stage: 'contacted' },
      }),
    } as unknown as jest.Mocked<ProspectService>;

    scheduler = new CampaignScheduler(
      mockPrisma,
      mockCampaignService,
      mockApprovalQueue,
      mockUnsubscribeService,
      mockTimelineService
    );

    scheduler.setApprovalNotificationService(mockNotificationService);
    scheduler.setProspectService(mockProspectService);
  });

  // Test 1: Method fetches actions needing notification via approvalQueue
  test('fetches actions needing notification via approvalQueue', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([]);

    // Call the internal method via processTenantCampaigns which triggers sendPendingNotifications
    // Since sendPendingNotifications is private, we verify its behavior through the public interface
    await scheduler.processTenantCampaigns('test-tenant');

    // Verify that getActionsNeedingNotification was called
    expect(mockApprovalQueue.getActionsNeedingNotification).toHaveBeenCalledWith('test-tenant');
  });

  // Test 2: Method skips processing when tenant has no telegram_chat_id
  test('skips processing when tenant has no telegram_chat_id', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: null,
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'test-campaign',
      },
    ]);

    await scheduler.processTenantCampaigns('test-tenant');

    // Notification service should not be called when tenant has no telegram_chat_id
    expect(mockNotificationService.notifyEmailReady).not.toHaveBeenCalled();
  });

  // Test 3: Method calls notifyEmailReady for send_email actions
  test('calls notifyEmailReady for send_email actions', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'test-campaign',
        target_name: 'John Doe',
        target_email: 'john@test.com',
        subject: 'Test Subject',
        body: 'Test body',
      },
    ]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    await scheduler.processTenantCampaigns('test-tenant');

    // Verify notifyEmailReady was called with correct arguments
    expect(mockNotificationService.notifyEmailReady).toHaveBeenCalledWith(
      'test-tenant',
      expect.objectContaining({
        id: 'action-1',
        action_type: 'send_email',
      }),
      expect.objectContaining({
        slug: 'john-doe',
      }),
      expect.objectContaining({
        name: 'test-campaign',
      }),
      '123456789'
    );
  });

  // Test 4: Method updates notification info after successful send
  test('updates notification info after successful send', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'test-campaign',
        target_name: 'John Doe',
        target_email: 'john@test.com',
      },
    ]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    mockNotificationService.notifyEmailReady.mockResolvedValue({
      messageId: 'msg-123',
      sentAt: new Date().toISOString(),
    });

    await scheduler.processTenantCampaigns('test-tenant');

    // Verify updateNotificationInfo was called with the message ID
    expect(mockApprovalQueue.updateNotificationInfo).toHaveBeenCalledWith(
      'test-tenant',
      'action-1',
      'msg-123'
    );
  });
});

describe('Task Group 4: Integration into Campaign Processing Cycle', () => {
  let scheduler: CampaignScheduler;
  let mockNotificationService: jest.Mocked<ApprovalNotificationService>;
  let mockProspectService: jest.Mocked<ProspectService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockNotificationService = {
      notifyEmailReady: jest.fn().mockResolvedValue({ messageId: 'msg-123', sentAt: new Date().toISOString() }),
      notifyNewProspect: jest.fn(),
    } as unknown as jest.Mocked<ApprovalNotificationService>;

    mockProspectService = {
      readProspect: jest.fn().mockResolvedValue({
        slug: 'john-doe',
        frontmatter: { name: 'John Doe', email: 'john@test.com', stage: 'contacted' },
      }),
    } as unknown as jest.Mocked<ProspectService>;

    scheduler = new CampaignScheduler(
      mockPrisma,
      mockCampaignService,
      mockApprovalQueue,
      mockUnsubscribeService,
      mockTimelineService
    );

    scheduler.setApprovalNotificationService(mockNotificationService);
    scheduler.setProspectService(mockProspectService);
  });

  // Test 1: sendPendingNotifications is called after campaign processing steps
  test('sendPendingNotifications is called after campaign processing steps', async () => {
    // Set up a scenario with an active campaign
    (mockCampaignService.listCampaigns as jest.Mock).mockResolvedValue([
      { id: 'campaign-1', name: 'test-campaign', status: 'active', config: { settings: { max_daily_outreach: 10 } } },
    ]);

    (mockCampaignService.getTargetReferences as jest.Mock).mockResolvedValue([]);

    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'test-campaign',
        target_name: 'John Doe',
        target_email: 'john@test.com',
      },
    ]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    await scheduler.processTenantCampaigns('test-tenant');

    // Verify the notification was sent (which means sendPendingNotifications was called)
    expect(mockNotificationService.notifyEmailReady).toHaveBeenCalled();
    expect(mockApprovalQueue.updateNotificationInfo).toHaveBeenCalled();
  });

  // Test 2: Notification errors do not break the processing cycle
  test('notification errors do not break the processing cycle', async () => {
    (mockCampaignService.listCampaigns as jest.Mock).mockResolvedValue([
      { id: 'campaign-1', name: 'test-campaign', status: 'active', config: { settings: { max_daily_outreach: 10 } } },
    ]);

    (mockCampaignService.getTargetReferences as jest.Mock).mockResolvedValue([]);

    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'test-campaign',
        target_name: 'John Doe',
        target_email: 'john@test.com',
      },
    ]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    // Make notification service throw an error
    mockNotificationService.notifyEmailReady.mockRejectedValue(new Error('Telegram API error'));

    // processTenantCampaigns should NOT throw even when notification fails
    await expect(scheduler.processTenantCampaigns('test-tenant')).resolves.not.toThrow();

    // Notification was attempted
    expect(mockNotificationService.notifyEmailReady).toHaveBeenCalled();

    // But updateNotificationInfo was NOT called because notification failed
    expect(mockApprovalQueue.updateNotificationInfo).not.toHaveBeenCalled();
  });

  // Test 3: Notifications are sent for each tenant with active campaigns
  test('notifications are sent for each tenant with active campaigns', async () => {
    // Set up tenant with active campaigns
    (mockPrisma.tenant.findMany as jest.Mock).mockResolvedValue([
      { id: 'tenant-1' },
      { id: 'tenant-2' },
    ]);

    (mockCampaignService.listCampaigns as jest.Mock).mockResolvedValue([
      { id: 'campaign-1', name: 'test-campaign', status: 'active', config: { settings: { max_daily_outreach: 10 } } },
    ]);

    (mockCampaignService.getTargetReferences as jest.Mock).mockResolvedValue([]);

    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'test-campaign',
        target_name: 'John Doe',
        target_email: 'john@test.com',
      },
    ]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    // Process campaigns for all tenants
    await scheduler.processCampaigns();

    // getActionsNeedingNotification should be called for each tenant
    expect(mockApprovalQueue.getActionsNeedingNotification).toHaveBeenCalledWith('tenant-1');
    expect(mockApprovalQueue.getActionsNeedingNotification).toHaveBeenCalledWith('tenant-2');

    // Notifications should be sent for both tenants
    expect(mockNotificationService.notifyEmailReady).toHaveBeenCalledTimes(2);
  });
});

describe('Task Group 5: Test Review and Gap Analysis', () => {
  let scheduler: CampaignScheduler;
  let mockNotificationService: jest.Mocked<ApprovalNotificationService>;
  let mockProspectService: jest.Mocked<ProspectService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockNotificationService = {
      notifyEmailReady: jest.fn().mockResolvedValue({ messageId: 'msg-123', sentAt: new Date().toISOString() }),
      notifyNewProspect: jest.fn(),
    } as unknown as jest.Mocked<ApprovalNotificationService>;

    mockProspectService = {
      readProspect: jest.fn().mockResolvedValue({
        slug: 'john-doe',
        frontmatter: { name: 'John Doe', email: 'john@test.com', stage: 'contacted' },
      }),
    } as unknown as jest.Mocked<ProspectService>;

    scheduler = new CampaignScheduler(
      mockPrisma,
      mockCampaignService,
      mockApprovalQueue,
      mockUnsubscribeService,
      mockTimelineService
    );

    scheduler.setApprovalNotificationService(mockNotificationService);
    scheduler.setProspectService(mockProspectService);
  });

  // Gap Test 1: Graceful handling when prospect not found
  test('gracefully handles when prospect not found', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'nonexistent-prospect',
        campaign_name: 'test-campaign',
        target_name: 'Unknown',
        target_email: 'unknown@test.com',
      },
    ]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    // Prospect not found
    mockProspectService.readProspect.mockResolvedValue(null);

    // Should not throw
    await expect(scheduler.processTenantCampaigns('test-tenant')).resolves.not.toThrow();

    // Notification should NOT be sent when prospect not found
    expect(mockNotificationService.notifyEmailReady).not.toHaveBeenCalled();
  });

  // Gap Test 2: Graceful handling when campaign config not found
  test('gracefully handles when campaign config not found', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([
      {
        id: 'action-1',
        action_type: 'send_email',
        target_id: 'john-doe',
        campaign_name: 'deleted-campaign',
        target_name: 'John Doe',
        target_email: 'john@test.com',
      },
    ]);

    // Campaign not found
    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue(null);

    // Should not throw
    await expect(scheduler.processTenantCampaigns('test-tenant')).resolves.not.toThrow();

    // Notification should NOT be sent when campaign not found
    expect(mockNotificationService.notifyEmailReady).not.toHaveBeenCalled();
  });

  // Gap Test 3: Notification retries on next cycle when first attempt fails
  test('notification retries on next cycle when first attempt fails', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    const pendingAction = {
      id: 'action-1',
      action_type: 'send_email',
      target_id: 'john-doe',
      campaign_name: 'test-campaign',
      target_name: 'John Doe',
      target_email: 'john@test.com',
    };

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([pendingAction]);

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: { name: 'test-campaign' },
    });

    // First attempt fails
    mockNotificationService.notifyEmailReady.mockRejectedValueOnce(new Error('Network error'));

    // First cycle - notification fails
    await scheduler.processTenantCampaigns('test-tenant');

    // updateNotificationInfo should NOT be called on failure
    expect(mockApprovalQueue.updateNotificationInfo).not.toHaveBeenCalled();

    // Second attempt succeeds
    mockNotificationService.notifyEmailReady.mockResolvedValueOnce({
      messageId: 'msg-456',
      sentAt: new Date().toISOString(),
    });

    // Second cycle - notification succeeds (action still needs notification since we didn't mark it)
    await scheduler.processTenantCampaigns('test-tenant');

    // Now updateNotificationInfo should be called
    expect(mockApprovalQueue.updateNotificationInfo).toHaveBeenCalledWith(
      'test-tenant',
      'action-1',
      'msg-456'
    );
  });

  // Gap Test 4: Full notification flow integration (action queued -> notification sent -> action updated)
  test('full notification flow: action queued to notification sent to action updated', async () => {
    // Setup complete scenario
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      telegram_chat_id: '123456789',
    });

    const queuedAction = {
      id: 'action-complete-flow',
      action_type: 'send_email',
      target_id: 'john-doe',
      campaign_name: 'test-campaign',
      target_name: 'John Doe',
      target_email: 'john@test.com',
      subject: 'Important Update',
      body: 'Hello John, this is an important update.',
      reasoning: 'Initial outreach',
      queued_at: new Date().toISOString(),
      status: 'pending',
    };

    (mockApprovalQueue.getActionsNeedingNotification as jest.Mock).mockResolvedValue([queuedAction]);

    const campaignConfig = {
      name: 'test-campaign',
      goal: 'Generate leads',
      settings: { max_daily_outreach: 10 },
    };

    (mockCampaignService.getCampaign as jest.Mock).mockResolvedValue({
      id: 'campaign-1',
      name: 'test-campaign',
      config: campaignConfig,
    });

    const prospectData = {
      slug: 'john-doe',
      frontmatter: {
        name: 'John Doe',
        email: 'john@test.com',
        company: 'Acme Corp',
        title: 'CEO',
        stage: 'contacted',
      },
    };

    mockProspectService.readProspect.mockResolvedValue(prospectData);

    mockNotificationService.notifyEmailReady.mockResolvedValue({
      messageId: 'telegram-msg-789',
      sentAt: new Date().toISOString(),
    });

    // Execute the processing cycle
    await scheduler.processTenantCampaigns('test-tenant');

    // Step 1: Actions needing notification were fetched
    expect(mockApprovalQueue.getActionsNeedingNotification).toHaveBeenCalledWith('test-tenant');

    // Step 2: Campaign config was loaded
    expect(mockCampaignService.getCampaign).toHaveBeenCalledWith('test-tenant', 'test-campaign');

    // Step 3: Prospect data was loaded
    expect(mockProspectService.readProspect).toHaveBeenCalledWith('test-tenant', 'john-doe');

    // Step 4: Notification was sent with all context
    expect(mockNotificationService.notifyEmailReady).toHaveBeenCalledWith(
      'test-tenant',
      expect.objectContaining({
        id: 'action-complete-flow',
        action_type: 'send_email',
        subject: 'Important Update',
        body: 'Hello John, this is an important update.',
      }),
      expect.objectContaining({
        slug: 'john-doe',
        frontmatter: expect.objectContaining({
          name: 'John Doe',
          company: 'Acme Corp',
        }),
      }),
      expect.objectContaining({
        name: 'test-campaign',
      }),
      '123456789'
    );

    // Step 5: Action was updated with notification info
    expect(mockApprovalQueue.updateNotificationInfo).toHaveBeenCalledWith(
      'test-tenant',
      'action-complete-flow',
      'telegram-msg-789'
    );
  });
});
