// Tenant status enum - matches Prisma schema
export type TenantStatus = 'TRIAL' | 'ACTIVE' | 'CHURNED';

// Onboarding status enum - matches Prisma schema
export type OnboardingStatus = 'DISCOVERY' | 'BUILDING' | 'LIVE' | 'PAUSED';

// Messaging channel enum - matches Prisma schema
export type MessagingChannel = 'WHATSAPP' | 'TELEGRAM';

export interface Tenant {
  id: string;
  name: string;
  phoneNumber: string;
  messagingChannel: MessagingChannel;
  whatsappPhoneNumberId: string | null;
  telegramChatId: string | null;
  status: TenantStatus;
  onboardingStatus: OnboardingStatus;
  createdAt: Date;
  updatedAt: Date;
}
