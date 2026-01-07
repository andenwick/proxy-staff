/**
 * Onboarding Types
 * TypeScript interfaces for the onboarding workflow
 */

// Question Types
export type QuestionType = 'text' | 'multiline' | 'select' | 'multi-select' | 'list';

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  category: string;
  question: string;
  type: QuestionType;
  required: boolean;
  options?: QuestionOption[];
  placeholder?: string;
  default?: string | string[];
}

// Business Profile (identity/profile.md)
export interface BusinessProfile {
  name: string;
  industry: string;
  location: {
    city: string;
    state: string;
    country?: string;
  };
  hours: {
    timezone: string;
    schedule: string; // e.g., "Mon-Fri 9am-5pm"
  };
  owner: {
    name: string;
    role: string;
  };
}

// Voice Profile (identity/voice.md)
export interface VoiceProfile {
  tone: 'professional' | 'casual' | 'friendly' | 'formal' | 'conversational';
  style: 'concise' | 'detailed' | 'conversational';
  personality: string[];
  avoidWords: string[];
  preferWords: string[];
}

// Service Offering (knowledge/services.md)
export interface ServiceOffering {
  name: string;
  description: string;
  targetCustomer?: string;
  differentiators?: string[];
}

// Pricing Info (knowledge/pricing.md)
export interface PricingInfo {
  model: 'hourly' | 'per-project' | 'subscription' | 'custom';
  ranges?: string;
  tiers?: PricingTier[];
  paymentTerms?: string;
}

export interface PricingTier {
  name: string;
  price: string;
  description: string;
  features: string[];
}

// FAQ Entry (knowledge/faqs.md)
export interface FaqEntry {
  question: string;
  answer: string;
}

// Policy (knowledge/policies.md)
export interface Policy {
  name: string;
  content: string;
}

// Workflow Definition (operations/workflows/)
export interface WorkflowDefinition {
  id: string;
  name: string;
  enabled: boolean;
  customizations?: Record<string, string>;
}

// Goals (operations/state/goals.md)
export interface Goals {
  primaryObjective: string;
  painPoints: string[];
  tasksToAutomate: string[];
  successMetrics: string[];
}

// Full Onboarding Response
export interface OnboardingResponse {
  tenantId: string;
  collectedAt: string;

  // Core sections
  business: BusinessProfile;
  voice: VoiceProfile;
  services: ServiceOffering[];
  pricing: PricingInfo;
  faqs: FaqEntry[];
  policies: Policy[];
  workflows: WorkflowDefinition[];
  goals: Goals;

  // Optional extras
  credentials?: Record<string, string>;
  customData?: Record<string, unknown>;
}

// Validation Result
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
}

// File Generation Result
export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerationResult {
  success: boolean;
  files: GeneratedFile[];
  errors: string[];
}
