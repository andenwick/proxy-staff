/**
 * Interview Questions
 * Structured questions for onboarding new tenants
 */

import { Question } from './types.js';

export const QUESTION_CATEGORIES = [
  'business',
  'voice',
  'services',
  'pricing',
  'workflows',
  'goals',
] as const;

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

// Business Basics Questions
export const businessQuestions: Question[] = [
  {
    id: 'business_name',
    category: 'business',
    question: 'What is your business name?',
    type: 'text',
    required: true,
    placeholder: 'Acme Corp',
  },
  {
    id: 'industry',
    category: 'business',
    question: 'What industry are you in?',
    type: 'select',
    required: true,
    options: [
      { value: 'real-estate', label: 'Real Estate' },
      { value: 'consulting', label: 'Consulting' },
      { value: 'ecommerce', label: 'E-Commerce' },
      { value: 'saas', label: 'SaaS / Software' },
      { value: 'agency', label: 'Agency / Marketing' },
      { value: 'healthcare', label: 'Healthcare' },
      { value: 'legal', label: 'Legal' },
      { value: 'finance', label: 'Finance' },
      { value: 'construction', label: 'Construction / Trades' },
      { value: 'hospitality', label: 'Hospitality / Food' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'location_city',
    category: 'business',
    question: 'What city is your business located in?',
    type: 'text',
    required: true,
    placeholder: 'Salt Lake City',
  },
  {
    id: 'location_state',
    category: 'business',
    question: 'What state/province?',
    type: 'text',
    required: true,
    placeholder: 'Utah',
  },
  {
    id: 'timezone',
    category: 'business',
    question: 'What timezone do you operate in?',
    type: 'select',
    required: true,
    options: [
      { value: 'America/New_York', label: 'Eastern (ET)' },
      { value: 'America/Chicago', label: 'Central (CT)' },
      { value: 'America/Denver', label: 'Mountain (MT)' },
      { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
      { value: 'America/Phoenix', label: 'Arizona (no DST)' },
      { value: 'UTC', label: 'UTC' },
    ],
    default: 'America/Denver',
  },
  {
    id: 'business_hours',
    category: 'business',
    question: 'What are your business hours?',
    type: 'text',
    required: false,
    placeholder: 'Mon-Fri 9am-5pm',
    default: 'Mon-Fri 9am-5pm',
  },
  {
    id: 'owner_name',
    category: 'business',
    question: "What is the owner's name?",
    type: 'text',
    required: true,
    placeholder: 'John Smith',
  },
  {
    id: 'owner_role',
    category: 'business',
    question: "What is the owner's role/title?",
    type: 'text',
    required: false,
    placeholder: 'Founder & CEO',
    default: 'Owner',
  },
];

// Voice & Personality Questions
export const voiceQuestions: Question[] = [
  {
    id: 'tone',
    category: 'voice',
    question: 'What tone should your AI assistant use?',
    type: 'select',
    required: true,
    options: [
      { value: 'professional', label: 'Professional - Business-like and polished' },
      { value: 'friendly', label: 'Friendly - Warm and approachable' },
      { value: 'casual', label: 'Casual - Relaxed and conversational' },
      { value: 'formal', label: 'Formal - Traditional and structured' },
      { value: 'conversational', label: 'Conversational - Natural and engaging' },
    ],
    default: 'friendly',
  },
  {
    id: 'style',
    category: 'voice',
    question: 'How should responses be styled?',
    type: 'select',
    required: true,
    options: [
      { value: 'concise', label: 'Concise - Short and to the point' },
      { value: 'detailed', label: 'Detailed - Thorough explanations' },
      { value: 'conversational', label: 'Conversational - Natural back-and-forth' },
    ],
    default: 'concise',
  },
  {
    id: 'personality_traits',
    category: 'voice',
    question: 'What personality traits should your AI embody? (select multiple)',
    type: 'multi-select',
    required: false,
    options: [
      { value: 'helpful', label: 'Helpful' },
      { value: 'knowledgeable', label: 'Knowledgeable' },
      { value: 'patient', label: 'Patient' },
      { value: 'enthusiastic', label: 'Enthusiastic' },
      { value: 'empathetic', label: 'Empathetic' },
      { value: 'direct', label: 'Direct' },
      { value: 'proactive', label: 'Proactive' },
    ],
    default: ['helpful', 'knowledgeable'],
  },
  {
    id: 'avoid_words',
    category: 'voice',
    question: 'Any words or phrases to avoid?',
    type: 'list',
    required: false,
    placeholder: 'e.g., "ASAP", "synergy", "leverage"',
  },
  {
    id: 'prefer_words',
    category: 'voice',
    question: 'Any preferred terminology or phrases?',
    type: 'list',
    required: false,
    placeholder: 'e.g., "clients" instead of "customers"',
  },
];

// Services Questions
export const servicesQuestions: Question[] = [
  {
    id: 'services_list',
    category: 'services',
    question: 'List your main services or products (one per line)',
    type: 'multiline',
    required: true,
    placeholder: 'Residential sales\nProperty management\nCommercial leasing',
  },
  {
    id: 'service_descriptions',
    category: 'services',
    question: 'Describe your primary service in 1-2 sentences',
    type: 'multiline',
    required: false,
    placeholder: 'We help first-time homebuyers find their dream home...',
  },
  {
    id: 'target_customer',
    category: 'services',
    question: 'Who is your ideal customer?',
    type: 'text',
    required: false,
    placeholder: 'First-time homebuyers in the Salt Lake Valley',
  },
  {
    id: 'differentiators',
    category: 'services',
    question: 'What makes you different from competitors?',
    type: 'multiline',
    required: false,
    placeholder: '20+ years experience\nLocal market expertise\n24/7 availability',
  },
];

// Pricing Questions
export const pricingQuestions: Question[] = [
  {
    id: 'pricing_model',
    category: 'pricing',
    question: 'How do you price your services?',
    type: 'select',
    required: false,
    options: [
      { value: 'hourly', label: 'Hourly rate' },
      { value: 'per-project', label: 'Per project / flat fee' },
      { value: 'subscription', label: 'Subscription / retainer' },
      { value: 'commission', label: 'Commission-based' },
      { value: 'custom', label: 'Custom / varies' },
    ],
  },
  {
    id: 'price_ranges',
    category: 'pricing',
    question: 'What are your typical price ranges?',
    type: 'text',
    required: false,
    placeholder: '$100-500 per project',
  },
  {
    id: 'payment_terms',
    category: 'pricing',
    question: 'What are your payment terms?',
    type: 'text',
    required: false,
    placeholder: '50% upfront, 50% on completion',
  },
];

// Workflow Questions
export const workflowQuestions: Question[] = [
  {
    id: 'enabled_workflows',
    category: 'workflows',
    question: 'Which workflows should your AI handle? (select all that apply)',
    type: 'multi-select',
    required: true,
    options: [
      { value: 'lead-handling', label: 'Lead Handling - Respond to new inquiries' },
      { value: 'appointment-scheduling', label: 'Appointment Scheduling - Book meetings' },
      { value: 'follow-up', label: 'Follow-up - Check in with prospects/clients' },
      { value: 'inquiry-response', label: 'Inquiry Response - Answer questions' },
      { value: 'email-management', label: 'Email Management - Daily email processing' },
    ],
    default: ['lead-handling', 'inquiry-response'],
  },
  {
    id: 'lead_response',
    category: 'workflows',
    question: 'How should new leads be handled?',
    type: 'multiline',
    required: false,
    placeholder: 'Respond within 5 minutes\nAsk about their needs\nSchedule a call',
  },
  {
    id: 'followup_cadence',
    category: 'workflows',
    question: 'How often should we follow up with prospects?',
    type: 'select',
    required: false,
    options: [
      { value: 'daily', label: 'Daily' },
      { value: 'every-2-days', label: 'Every 2 days' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'custom', label: 'Custom schedule' },
    ],
    default: 'every-2-days',
  },
];

// Goals Questions
export const goalsQuestions: Question[] = [
  {
    id: 'primary_objective',
    category: 'goals',
    question: 'What is the #1 thing you want your AI assistant to do?',
    type: 'text',
    required: true,
    placeholder: 'Respond to leads instantly so I never miss an opportunity',
  },
  {
    id: 'pain_points',
    category: 'goals',
    question: 'What problems are you trying to solve? (one per line)',
    type: 'multiline',
    required: false,
    placeholder: 'Missing calls while with clients\nForgetting to follow up\nSpending too much time on email',
  },
  {
    id: 'tasks_to_automate',
    category: 'goals',
    question: 'What specific tasks do you want automated? (one per line)',
    type: 'multiline',
    required: false,
    placeholder: 'Initial lead response\nAppointment reminders\nFollow-up emails',
  },
  {
    id: 'success_metrics',
    category: 'goals',
    question: 'How will you measure success?',
    type: 'multiline',
    required: false,
    placeholder: 'Response time under 5 minutes\nNo missed leads\nMore booked appointments',
  },
];

// All questions combined
export const allQuestions: Question[] = [
  ...businessQuestions,
  ...voiceQuestions,
  ...servicesQuestions,
  ...pricingQuestions,
  ...workflowQuestions,
  ...goalsQuestions,
];

// Get questions by category
export function getQuestionsByCategory(category: QuestionCategory): Question[] {
  return allQuestions.filter((q) => q.category === category);
}

// Get required questions only
export function getRequiredQuestions(): Question[] {
  return allQuestions.filter((q) => q.required);
}
