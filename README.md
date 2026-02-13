# ProxyStaff

Multi-tenant AI assistant platform that connects Claude to WhatsApp and Telegram. Each tenant gets isolated configuration, persistent memory, custom Python tools, and scheduled task execution.

Built this to give realtors (and eventually any small business) an AI assistant they can talk to on the messaging apps they already use.

## What It Does

- **Multi-channel messaging** — WhatsApp Business API and Telegram Bot API, with per-tenant channel routing
- **Multi-tenant isolation** — separate configs, tools, credentials, and memory per tenant. Database-level isolation with cascade deletes
- **Persistent memory** — structured life folder system (identity, boundaries, knowledge, relationships) that persists across conversations. Claude learns who you are over time
- **Scheduled tasks** — natural language scheduling ("remind me tomorrow at 9am") parsed into cron expressions. Distributed execution with PostgreSQL advisory locks and lease-based claiming
- **Custom tooling** — tenants can add Python scripts as tools with their own credentials. Scripts run in isolated subprocesses
- **Self-improvement** — feedback loop that tracks tool executions, detects failure patterns, and auto-updates directives with rollback verification
- **Onboarding flow** — three-phase discovery system (DISCOVERY → BUILDING → LIVE) that gradually learns about each tenant

## Architecture

```
WhatsApp/Telegram → Fastify webhooks → Tenant resolution → Message processor
                                                                ↓
                                              Claude API (with tenant context + tools)
                                                                ↓
                                              Tool execution → Response → Send reply
                                                                ↓
                                              PostgreSQL (messages, sessions, tasks, memory)
```

**Key services:**
- `messageProcessor` — orchestration hub. Resolves tenant, loads context, calls Claude, executes tools, sends responses
- `schedulerService` — cron-based task scheduler with distributed locking (50 tasks/tick, 300s TTL, auto-retry with backoff)
- `learningService` — end-of-conversation and periodic memory extraction
- `tenantFolder` — manages the life folder system and CLAUDE.md framework per tenant
- `pythonRunner` — sandboxed Python subprocess execution for tenant tools

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js, TypeScript (ES2022) |
| Framework | Fastify |
| Database | PostgreSQL, Prisma ORM |
| AI | Anthropic Claude API |
| Messaging | WhatsApp Cloud API (Meta), Telegram Bot API |
| Queue | BullMQ + Redis |
| Scheduling | node-cron + PostgreSQL leases |
| Deployment | Railway (Docker) |

## Project Structure

```
src/
├── server.ts              # Fastify setup
├── routes/                # Webhook handlers, health, metrics
├── services/              # Core business logic
│   ├── messageProcessor   # Message orchestration
│   ├── schedulerService   # Task scheduling
│   ├── learningService    # Memory extraction
│   ├── session            # Conversation sessions
│   ├── tenant             # Multi-tenant resolution
│   └── messaging/         # Channel adapters (WhatsApp, Telegram)
├── tools/                 # Shared tool registry
├── templates/             # Tenant folder templates
└── utils/                 # Logger, encryption, metrics

scripts/                   # Tenant management CLI tools
prisma/                    # Schema + migrations
tenants/                   # Per-tenant config (gitignored)
docs/                      # Operational docs
```

## Setup

```bash
npm install
cp .env.example .env       # Configure credentials
docker compose up -d       # PostgreSQL + Redis
npx prisma migrate deploy
npm run dev
```

Tenant onboarding: `npm run onboard`

## License

Proprietary — All rights reserved.
