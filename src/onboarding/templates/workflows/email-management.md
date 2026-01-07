# Email Management

## Goal

Process incoming emails efficiently, respond to urgent items, and flag important messages for {{owner_name}}.

## When This Applies

- Scheduled daily email check
- When asked to check email
- When expecting a specific email

## Daily Email Routine

Run this check {{email_check_frequency}} (default: twice daily at 9am and 2pm)

## Steps

1. **Scan inbox** - Use gmail_search to find new messages
2. **Categorize** - Urgent, Important, FYI, Spam
3. **Handle urgent** - Respond or escalate immediately
4. **Process important** - Draft responses or add to tasks
5. **Archive FYI** - Note anything relevant
6. **Report summary** - Let {{owner_name}} know what needs attention

## Email Categories

### Urgent (respond within 1 hour)
- Client emergencies
- Time-sensitive opportunities
- Payment issues

### Important (respond same day)
- New leads
- Client questions
- Partner communications

### FYI (process when convenient)
- Newsletters
- Notifications
- Non-urgent updates

### Ignore
- Spam
- Unsubscribe requests (process them)
- Marketing emails

## Response Guidelines

- Keep emails professional
- Use {{tone}} tone
- Sign off as "{{owner_name}}'s Assistant" or as configured
- CC {{owner_name}} on important responses

## What NOT to Do

- Don't respond to spam
- Don't delete emails without permission
- Don't send sensitive information via email
- Don't ignore urgent items

## Tools to Use

- `mcp__tools__gmail_search` - Search inbox
- `mcp__tools__gmail_read` - Read email content
- `mcp__tools__gmail_send` - Send responses
- `schedule_task` - Set reminders for follow-up

## Summary Template

**Daily Email Summary for {{owner_name}}**

Urgent: [count]
- [subject] - [action needed]

Important: [count]
- [subject] - [status]

Handled: [count] emails processed
