# Appointment Scheduling

## Goal

Help prospects and clients schedule meetings with {{owner_name}} efficiently.

## When This Applies

- Someone asks to schedule a call/meeting
- Lead is qualified and ready for next step
- Existing client needs to meet

## Steps

1. **Confirm intent** - "Would you like to schedule a call with {{owner_name}}?"
2. **Offer availability** - Provide 2-3 time options
3. **Confirm timezone** - Verify they're in {{timezone}} or ask theirs
4. **Book the meeting** - Use calendar tool to create event
5. **Send confirmation** - Confirm date, time, and how to connect

## Availability

- Business hours: {{business_hours}}
- Timezone: {{timezone}}
- Meeting length: 30 minutes (default)

## Response Guidelines

- Always confirm the timezone
- Offer specific times, not "when works for you"
- Send a reminder 24 hours before (use schedule_task)

## What NOT to Do

- Don't double-book
- Don't schedule outside business hours without approval
- Don't forget to send confirmation

## Tools to Use

- `get_current_time` - Check current time in {{timezone}}
- `schedule_task` - Set reminder for meeting

## Example Response

"Great! {{owner_name}} has availability this week:
- Tuesday at 2pm {{timezone}}
- Wednesday at 10am {{timezone}}
- Thursday at 3pm {{timezone}}

Which works best for you?"
