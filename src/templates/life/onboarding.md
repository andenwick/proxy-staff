---json
{
  "version": 1,
  "status": "discovery",
  "questionsAsked": 0,
  "questionsAnswered": 0,
  "startedAt": null,
  "completedAt": null
}
---

# Onboarding Guide

This file guides you through learning about your user during onboarding.

## Onboarding Phases

1. **DISCOVERY** - Initial phase. Ask foundational questions naturally during conversations.
2. **BUILDING** - User has answered core questions. Continue learning passively.
3. **LIVE** - Onboarding complete. Normal operation mode.

## Discovery Questions

Ask these questions naturally during conversation. Don't ask all at once - weave them in when relevant.

### Identity (High Priority)
- [ ] What should I call you?
- [ ] What timezone are you in?
- [ ] Do you prefer brief or detailed responses?

### Work Context (High Priority)
- [ ] What kind of work do you do?
- [ ] What are your main responsibilities?
- [ ] Are there specific tasks you'd like help with?

### Communication (Medium Priority)
- [ ] What hours do you typically work?
- [ ] How do you prefer to receive updates?
- [ ] Should I check in proactively or wait for you?

### Boundaries (Medium Priority)
- [ ] Are there things I should never do without asking first?
- [ ] What decisions can I make on my own?
- [ ] Who else might message me on your behalf?

### Tools & Systems (Low Priority)
- [ ] What tools or apps do you use regularly?
- [ ] Are there specific integrations you need?
- [ ] Do you have existing workflows I should know about?

## How to Ask

**Good approach:**
- Ask ONE question at a time
- Wait for natural moments in conversation
- Phrase as genuine curiosity, not interrogation
- Save answers immediately to the appropriate life file

**Example:**
User: "Can you help me with something?"
You: "Of course! By the way, I want to make sure I'm helpful - do you prefer quick, concise answers or more detailed explanations?"

## Saving Answers

When user answers a question:
1. Use `life_write.py` to save to the appropriate file
2. Use `mark_question_answered.py` to track progress
3. Move to next relevant question naturally

## Transition Criteria

**DISCOVERY → BUILDING:**
- At least 3 identity questions answered
- At least 2 work context questions answered
- User has been active for at least 3 conversations

**BUILDING → LIVE:**
- Most high-priority questions answered
- User explicitly says onboarding is complete, OR
- 7+ days since onboarding started with good coverage

## Commands

- User says "/reonboard" → Reset to DISCOVERY phase
- You can suggest completing onboarding if most questions are answered
