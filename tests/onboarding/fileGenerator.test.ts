import {
  generateProfileMd,
  generateVoiceMd,
  generateServicesMd,
  generatePricingMd,
  generateFaqsMd,
  generatePoliciesMd,
  generateGoalsMd,
  replacePlaceholders,
} from '../../src/onboarding/fileGenerator';
import {
  BusinessProfile,
  VoiceProfile,
  ServiceOffering,
  PricingInfo,
  FaqEntry,
  Policy,
  Goals,
  OnboardingResponse,
} from '../../src/onboarding/types';

describe('fileGenerator', () => {
  describe('generateProfileMd', () => {
    it('generates profile markdown with correct structure', () => {
      const business: BusinessProfile = {
        name: 'Acme Corp',
        industry: 'consulting',
        location: { city: 'Salt Lake City', state: 'Utah' },
        hours: { timezone: 'America/Denver', schedule: 'Mon-Fri 9am-5pm' },
        owner: { name: 'John Smith', role: 'Founder' },
      };

      const result = generateProfileMd(business);

      expect(result.path).toBe('identity/profile.md');
      expect(result.content).toContain('# Acme Corp');
      expect(result.content).toContain('**Industry:** consulting');
      expect(result.content).toContain('**Location:** Salt Lake City, Utah');
      expect(result.content).toContain('**Name:** John Smith');
      expect(result.content).toContain('---json');
    });
  });

  describe('generateVoiceMd', () => {
    it('generates voice markdown with personality traits', () => {
      const voice: VoiceProfile = {
        tone: 'friendly',
        style: 'concise',
        personality: ['helpful', 'knowledgeable', 'patient'],
        avoidWords: ['synergy', 'leverage'],
        preferWords: ['clients', 'partners'],
      };

      const result = generateVoiceMd(voice);

      expect(result.path).toBe('identity/voice.md');
      expect(result.content).toContain('**friendly**');
      expect(result.content).toContain('- helpful');
      expect(result.content).toContain('- knowledgeable');
      expect(result.content).toContain('"synergy"');
      expect(result.content).toContain('"clients"');
    });

    it('handles empty arrays gracefully', () => {
      const voice: VoiceProfile = {
        tone: 'professional',
        style: 'detailed',
        personality: [],
        avoidWords: [],
        preferWords: [],
      };

      const result = generateVoiceMd(voice);

      expect(result.content).toContain('_None specified_');
    });
  });

  describe('generateServicesMd', () => {
    it('generates services list', () => {
      const services: ServiceOffering[] = [
        {
          name: 'Consulting',
          description: 'Strategic business advice',
          targetCustomer: 'Small businesses',
          differentiators: ['20 years experience', 'Local expertise'],
        },
        {
          name: 'Training',
          description: 'Team workshops',
        },
      ];

      const result = generateServicesMd(services);

      expect(result.path).toBe('knowledge/services.md');
      expect(result.content).toContain('### Consulting');
      expect(result.content).toContain('Strategic business advice');
      expect(result.content).toContain('**Target Customer:** Small businesses');
      expect(result.content).toContain('- 20 years experience');
      expect(result.content).toContain('### Training');
    });

    it('handles empty services array', () => {
      const result = generateServicesMd([]);
      expect(result.content).toContain('_No services defined yet_');
    });
  });

  describe('generatePricingMd', () => {
    it('generates pricing info', () => {
      const pricing: PricingInfo = {
        model: 'hourly',
        ranges: '$150-300/hr',
        paymentTerms: '50% upfront',
        tiers: [
          {
            name: 'Basic',
            price: '$150/hr',
            description: 'Standard consulting',
            features: ['Email support', '1 meeting/week'],
          },
        ],
      };

      const result = generatePricingMd(pricing);

      expect(result.path).toBe('knowledge/pricing.md');
      expect(result.content).toContain('**Type:** hourly');
      expect(result.content).toContain('$150-300/hr');
      expect(result.content).toContain('50% upfront');
      expect(result.content).toContain('### Basic - $150/hr');
    });
  });

  describe('generateFaqsMd', () => {
    it('generates FAQs list', () => {
      const faqs: FaqEntry[] = [
        { question: 'What do you offer?', answer: 'Consulting services.' },
        { question: 'Where are you located?', answer: 'Salt Lake City.' },
      ];

      const result = generateFaqsMd(faqs);

      expect(result.path).toBe('knowledge/faqs.md');
      expect(result.content).toContain('### What do you offer?');
      expect(result.content).toContain('Consulting services.');
    });
  });

  describe('generatePoliciesMd', () => {
    it('generates policies', () => {
      const policies: Policy[] = [
        { name: 'Refund Policy', content: 'Full refund within 30 days.' },
      ];

      const result = generatePoliciesMd(policies);

      expect(result.path).toBe('knowledge/policies.md');
      expect(result.content).toContain('## Refund Policy');
      expect(result.content).toContain('Full refund within 30 days.');
    });
  });

  describe('generateGoalsMd', () => {
    it('generates goals document', () => {
      const goals: Goals = {
        primaryObjective: 'Respond to leads instantly',
        painPoints: ['Missing calls', 'Slow follow-up'],
        tasksToAutomate: ['Lead response', 'Appointment booking'],
        successMetrics: ['Response time under 5 min', 'No missed leads'],
      };

      const result = generateGoalsMd(goals);

      expect(result.path).toBe('operations/state/goals.md');
      expect(result.content).toContain('Respond to leads instantly');
      expect(result.content).toContain('- Missing calls');
      expect(result.content).toContain('- Lead response');
      expect(result.content).toContain('- Response time under 5 min');
    });
  });

  describe('replacePlaceholders', () => {
    it('replaces all placeholders in template', () => {
      const template = 'Welcome to {{business_name}}! Contact {{owner_name}} at {{timezone}}.';
      const data: OnboardingResponse = {
        tenantId: 'test',
        collectedAt: new Date().toISOString(),
        business: {
          name: 'Acme Corp',
          industry: 'consulting',
          location: { city: 'SLC', state: 'UT' },
          hours: { timezone: 'America/Denver', schedule: '9-5' },
          owner: { name: 'John', role: 'CEO' },
        },
        voice: {
          tone: 'friendly',
          style: 'concise',
          personality: [],
          avoidWords: [],
          preferWords: [],
        },
        services: [{ name: 'Consulting', description: '' }],
        pricing: { model: 'hourly' },
        faqs: [],
        policies: [],
        workflows: [],
        goals: {
          primaryObjective: '',
          painPoints: [],
          tasksToAutomate: [],
          successMetrics: [],
        },
      };

      const result = replacePlaceholders(template, data);

      expect(result).toBe('Welcome to Acme Corp! Contact John at America/Denver.');
    });
  });
});
