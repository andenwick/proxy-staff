import { ClaudeCliService } from './claudeCli.js';
import { logger } from '../utils/logger.js';

// Internal sender ID for periodic learning (not a real user)
const PERIODIC_LEARNING_SENDER = 'system:periodic-learning';

/**
 * LearningService triggers learning at various points:
 * - End-of-conversation: When a session resets or expires
 * - Periodic: Scheduled review of recent conversations
 */
export class LearningService {
  private claudeCliService: ClaudeCliService;

  constructor(claudeCliService: ClaudeCliService) {
    this.claudeCliService = claudeCliService;
  }

  /**
   * Trigger end-of-conversation learning.
   *
   * Sends a reflection prompt to Claude to review what was learned
   * and update life files. This should be called BEFORE the session
   * is reset so Claude has access to the conversation context.
   *
   * @param tenantId - The tenant ID
   * @param senderPhone - The sender phone number
   * @param reason - Why learning was triggered (reset, expiry, etc.)
   */
  async triggerConversationEndLearning(
    tenantId: string,
    senderPhone: string,
    reason: 'reset' | 'expiry' | 'manual' = 'reset'
  ): Promise<void> {
    const reflectionPrompt = `[CONVERSATION REFLECTION - ${reason.toUpperCase()}]

The conversation has ended. Before the session resets, reflect on what you learned:

1. **Identity/Preferences**: Did the user share any preferences, communication style hints, or personal details?
   → Update life/identity.md if so

2. **Patterns**: Did you notice any patterns in how the user works, communicates, or makes decisions?
   → Update life/patterns.md if so

3. **Relationships**: Did the user mention any people with context (role, relationship, etc.)?
   → Update life/relationships/people.md if so

4. **Business Knowledge**: Did the user share any business facts, procedures, or domain knowledge?
   → Update life/knowledge/*.md if so

5. **Boundaries**: Did the user express any new rules, limits, or preferences about what to do/not do?
   → Update life/boundaries.md if so

**Instructions:**
- Use life_read.py to check current data before adding (avoid duplicates)
- Use life_write.py with operation "append" or "merge" to update
- Only save genuinely NEW information learned in this conversation
- Be concise and structured in what you save
- Complete silently - do not output any response to the user

Reflect now.`;

    try {
      logger.info(
        { tenantId, senderPhone, reason },
        'Triggering end-of-conversation learning'
      );

      // Send reflection prompt to Claude
      // Claude will execute tools to update life files
      await this.claudeCliService.sendMessage(
        tenantId,
        senderPhone,
        reflectionPrompt
      );

      logger.info(
        { tenantId, senderPhone, reason },
        'End-of-conversation learning completed'
      );
    } catch (error) {
      // Log but don't throw - learning failure shouldn't block session reset
      logger.error(
        { tenantId, senderPhone, reason, error },
        'End-of-conversation learning failed'
      );
    }
  }

  /**
   * Trigger periodic learning review.
   *
   * Unlike end-of-conversation learning, this:
   * - Uses search_history to review recent conversations
   * - Runs in its own CLI session (not tied to a user)
   * - Consolidates and validates existing learnings
   *
   * @param tenantId - The tenant ID to review
   */
  async triggerPeriodicLearning(tenantId: string): Promise<void> {
    const periodicPrompt = `[PERIODIC LEARNING REVIEW]

You are performing a scheduled learning review. Use search_history to review recent conversations (last 24 hours).

**Tasks:**

1. **Review Recent Conversations**
   Run: echo '{"hours": 24}' | python shared_tools/search_history.py
   Look for information that may have been missed during conversations.

2. **Pattern Detection**
   - Look for recurring themes, preferences, or behaviors
   - Check if existing patterns in life/patterns.md are still accurate
   - Add new patterns with confidence level "low" until confirmed

3. **Knowledge Consolidation**
   - Check life/knowledge/*.md for duplicate or conflicting information
   - Merge related facts where appropriate
   - Update confidence levels based on repetition

4. **Relationship Updates**
   - Check if any mentioned people need updated context
   - Look for relationship dynamics that weren't captured

5. **Discovery Questions**
   - Add questions to life/questions.md for things you'd like to learn
   - Mark questions as answered if you found the answers

**Instructions:**
- Use life_read.py to check current data
- Use life_write.py to update (operation: "merge" for updates, "append" for new items)
- Be conservative - only add high-confidence learnings
- Complete silently - no user response needed

Begin review.`;

    try {
      logger.info({ tenantId }, 'Triggering periodic learning review');

      // Use internal sender ID for periodic learning session
      await this.claudeCliService.sendMessage(
        tenantId,
        PERIODIC_LEARNING_SENDER,
        periodicPrompt
      );

      logger.info({ tenantId }, 'Periodic learning review completed');
    } catch (error) {
      logger.error(
        { tenantId, error },
        'Periodic learning review failed'
      );
      throw error; // Re-throw for scheduler to handle
    }
  }

  /**
   * Reset the periodic learning session for a tenant.
   * Called after each periodic learning to ensure fresh context next time.
   */
  async resetPeriodicSession(tenantId: string): Promise<void> {
    try {
      await this.claudeCliService.resetSession(tenantId, PERIODIC_LEARNING_SENDER);
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to reset periodic learning session');
    }
  }
}
