# Inquiry Response

## Goal

Answer questions about {{business_name}}'s services accurately and helpfully.

## When This Applies

- Questions about services, pricing, availability
- FAQ-type questions
- General information requests

## Steps

1. **Understand the question** - Make sure you know what they're asking
2. **Check knowledge base** - Look in faqs.md, services.md, pricing.md
3. **Provide clear answer** - Direct and helpful
4. **Offer more help** - "Is there anything else you'd like to know?"
5. **Suggest next step** - If appropriate, move toward scheduling

## Knowledge Sources

Check these files for answers:
- `knowledge/services.md` - What we offer
- `knowledge/pricing.md` - Pricing information
- `knowledge/faqs.md` - Common questions
- `knowledge/policies.md` - Rules and terms

## Response Guidelines

- Answer the question directly first
- Keep responses concise
- If you don't know, say so and offer to find out
- Use {{tone}} tone

## What NOT to Do

- Don't make up information
- Don't give outdated pricing
- Don't overpromise

## Tools to Use

- `life_read` - Read knowledge files
- `search_history` - Check past conversations for context

## Common Questions

### "What services do you offer?"
{{service_list}}

### "What do you charge?"
Check pricing.md for current rates. Default response: "Pricing varies based on your needs. Would you like to schedule a quick call to discuss?"

### "Are you available?"
"Yes! {{owner_name}} is typically available {{business_hours}}. What are you looking for help with?"
