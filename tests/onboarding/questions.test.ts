import {
  allQuestions,
  businessQuestions,
  voiceQuestions,
  servicesQuestions,
  pricingQuestions,
  workflowQuestions,
  goalsQuestions,
  getQuestionsByCategory,
  getRequiredQuestions,
  QUESTION_CATEGORIES,
} from '../../src/onboarding/questions';

describe('questions', () => {
  describe('allQuestions', () => {
    it('contains questions from all categories', () => {
      for (const category of QUESTION_CATEGORIES) {
        const categoryQuestions = allQuestions.filter((q) => q.category === category);
        expect(categoryQuestions.length).toBeGreaterThan(0);
      }
    });

    it('has unique IDs', () => {
      const ids = allQuestions.map((q) => q.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('has valid question types', () => {
      const validTypes = ['text', 'multiline', 'select', 'multi-select', 'list'];
      for (const q of allQuestions) {
        expect(validTypes).toContain(q.type);
      }
    });
  });

  describe('businessQuestions', () => {
    it('contains required business fields', () => {
      const ids = businessQuestions.map((q) => q.id);
      expect(ids).toContain('business_name');
      expect(ids).toContain('industry');
      expect(ids).toContain('location_city');
      expect(ids).toContain('owner_name');
    });

    it('has timezone as select with options', () => {
      const timezoneQ = businessQuestions.find((q) => q.id === 'timezone');
      expect(timezoneQ?.type).toBe('select');
      expect(timezoneQ?.options?.length).toBeGreaterThan(0);
    });
  });

  describe('voiceQuestions', () => {
    it('has tone and style as select', () => {
      const toneQ = voiceQuestions.find((q) => q.id === 'tone');
      const styleQ = voiceQuestions.find((q) => q.id === 'style');

      expect(toneQ?.type).toBe('select');
      expect(styleQ?.type).toBe('select');
    });

    it('has personality_traits as multi-select', () => {
      const personalityQ = voiceQuestions.find((q) => q.id === 'personality_traits');
      expect(personalityQ?.type).toBe('multi-select');
    });
  });

  describe('workflowQuestions', () => {
    it('has enabled_workflows as multi-select', () => {
      const workflowsQ = workflowQuestions.find((q) => q.id === 'enabled_workflows');
      expect(workflowsQ?.type).toBe('multi-select');
      expect(workflowsQ?.required).toBe(true);
    });

    it('includes standard workflow options', () => {
      const workflowsQ = workflowQuestions.find((q) => q.id === 'enabled_workflows');
      const values = workflowsQ?.options?.map((o) => o.value) || [];

      expect(values).toContain('lead-handling');
      expect(values).toContain('appointment-scheduling');
      expect(values).toContain('follow-up');
    });
  });

  describe('getQuestionsByCategory', () => {
    it('returns only questions from specified category', () => {
      const business = getQuestionsByCategory('business');
      expect(business.every((q) => q.category === 'business')).toBe(true);
      expect(business.length).toBe(businessQuestions.length);
    });
  });

  describe('getRequiredQuestions', () => {
    it('returns only required questions', () => {
      const required = getRequiredQuestions();
      expect(required.every((q) => q.required === true)).toBe(true);
    });

    it('includes business_name', () => {
      const required = getRequiredQuestions();
      expect(required.some((q) => q.id === 'business_name')).toBe(true);
    });
  });
});
