<p align="center">
  <h1 align="center">ProxyStaff</h1>
  <p align="center">
    <strong>AI-powered virtual assistant platform for realtors</strong>
  </p>
  <p align="center">
    <a href="#features"><img src="https://img.shields.io/badge/WhatsApp-25D366?style=flat&logo=whatsapp&logoColor=white" alt="WhatsApp"></a>
    <a href="#features"><img src="https://img.shields.io/badge/Telegram-2CA5E0?style=flat&logo=telegram&logoColor=white" alt="Telegram"></a>
    <a href="#technology-stack"><img src="https://img.shields.io/badge/Claude_AI-191919?style=flat&logo=anthropic&logoColor=white" alt="Claude AI"></a>
    <a href="#technology-stack"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
    <a href="#technology-stack"><img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL"></a>
  </p>
</p>

---

Multi-tenant AI assistant that integrates Claude with WhatsApp/Telegram, featuring scheduled task execution, persistent memory, and tenant-specific Python tooling.

## Features

- **Multi-Channel** - WhatsApp Business API + Telegram Bot support
- **Multi-Tenant** - Isolated configs, tools, and memory per tenant
- **Scheduled Tasks** - Natural language scheduling ("remind me tomorrow at 9am")
- **Persistent Memory** - Life folder system for long-term context
- **Custom Tools** - Tenant-specific Python scripts with credential management
- **Self-Improving** - Feedback loop for autonomous directive updates

## Realtor Use Cases

### Built-in Automations

| Capability | Example |
|------------|---------|
| **Scheduled Reminders** | "Remind me to call Sarah at 2pm tomorrow" |
| **Recurring Tasks** | "Every Monday at 9am remind me to check new listings" |
| **Conversation Search** | "What did I tell John about the Oak Street property?" |
| **Web Research** | "Search for comparable homes in Denver 80220" |
| **SOP Access** | Load sales scripts, objection handlers, pricing guides on-demand |

### Custom Tool Automations

Tenants can add Python tools for domain-specific automation:

| Automation | Description |
|------------|-------------|
| **Email Campaigns** | "Email Sarah the listing PDF" |
| **CRM Updates** | "Add John Smith as a lead interested in condos" |
| **Lead Scoring** | "Which of my leads are most likely to buy?" |
| **Listing Alerts** | Scheduled: "Every morning check for new listings matching criteria" |
| **Document Generation** | "Create a purchase agreement for 123 Main St" |
| **Calendar Integration** | "Book a showing for tomorrow at 3pm" |
| **SMS/Call Automation** | "Text all my hot leads about the open house" |
| **Market Analysis** | "What's the average price per sqft in this neighborhood?" |

### Proactive AI (Scheduled Execute Tasks)

Beyond reminders, `execute` tasks run tools automatically:

- "Every day at 8am, check my email and summarize client inquiries"
- "Every Friday at 4pm, generate a weekly activity report"
- "Every morning, check if any tracked listings had price changes"

### High-Value Realtor Workflows

1. **Lead Nurturing** - Automated follow-up sequences via scheduled tasks
2. **Client Communication** - Quick answers via WhatsApp anywhere
3. **Transaction Coordination** - Reminders for deadlines, inspections, closings
4. **Market Intelligence** - On-demand comps and pricing research
5. **Administrative Tasks** - Email drafting, CRM updates, report generation
6. **Team Coordination** - Shared SOPs, consistent messaging across agents

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js (TypeScript ES2022) |
| Web Framework | Fastify 5.6.2 |
| Database | PostgreSQL + Prisma ORM 7.1.0 |
| AI | Anthropic Claude CLI (claude-opus-4-5 via Max plan) |
| Messaging | WhatsApp Cloud API (Meta) / Telegram Bot API |
| Task Scheduling | node-cron + PostgreSQL leases |
| Logging | Pino |
| Testing | Jest + ts-jest |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│              WhatsApp Cloud API  /  Telegram Bot API                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Fastify Server                                                     │
│  ├── /health              Health check endpoint                     │
│  ├── /metrics             Prometheus-style metrics                  │
│  ├── /webhooks/whatsapp   WhatsApp message handler                  │
│  └── /webhooks/telegram   Telegram message handler                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐       ┌───────────────────────┐       ┌───────────────┐
│ TenantResolver│       │   MessageProcessor    │       │SchedulerService│
│               │       │   (Orchestration Hub) │       │ (Cron + Leases)│
└───────────────┘       └───────────────────────┘       └───────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐       ┌───────────────────────┐       ┌───────────────────┐
│LearningService│       │SessionEndJobProcessor │       │ LearningScheduler │
│ (Memory Sync) │       │ (Background Jobs)     │       │ (Periodic Review) │
└───────────────┘       └───────────────────────┘       └───────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐       ┌───────────────────────┐       ┌───────────────┐
│ ClaudeService │       │   Tool Executor       │       │WhatsAppService│
│ (AI Orchestr) │       │   Pipeline            │       │ (Message Send)│
└───────────────┘       └───────────────────────┘       └───────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐       ┌───────────────────────┐       ┌───────────────┐
│ Shared Tools  │       │ Tenant Python Tools   │       │TenantDirectives│
│ (Registry)    │       │ (PythonRunner)        │       │(SOPs/Prompts) │
└───────────────┘       └───────────────────────┘       └───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL (Prisma ORM)                         │
│  Tenant | TenantConfig | Message | Session | ScheduledTask | ...    │
└─────────────────────────────────────────────────────────────────────┘
```

## Self-Annealing System

ProxyStaff includes a self-annealing feedback loop that enables agents to autonomously improve their capabilities:

### Self-Modification Tools

| Tool | Description |
|------|-------------|
| `create_directive.py` | Create new SOPs from natural language |
| `update_directive.py` | Update existing directives |
| `create_tool.py` | Create new Python execution tools |
| `update_tool.py` | Update existing tools |

### Feedback Loop

1. **Execution Tracking** - Every tool call logged with input/output/timing
2. **Signal Collection** - User corrections and complaints auto-detected
3. **Pattern Analysis** - Failing tools and error patterns identified (runs every 6 hours)
4. **Auto-Improvement** - Directives updated based on patterns (max 3/day)
5. **Verification** - Improvements verified after 4 hours with auto-rollback if degraded

### Database Tables

| Table | Purpose |
|-------|---------|
| `tool_executions` | Tracks all tool calls with input/output/timing |
| `feedback_signals` | Stores feedback events (corrections, complaints) |
| `improvement_logs` | Records all improvements with before/after state |
| `performance_baselines` | Rolling metrics per tenant |

## Tenant Life System (Permanent Memory)

Each tenant has a permanent memory system that persists across all conversations, enabling Claude to build deep context over time through multiple learning triggers.

### Architecture

- **CLAUDE.md** — Universal static blueprint that teaches Claude how to navigate the tenant folder (same for all tenants)
- **life/ folder** — Tenant-specific permanent memory with structured JSON frontmatter

### Data Format: JSON Frontmatter

All life files use structured JSON frontmatter for reliable reading/writing:

```markdown
---json
{
  "version": 1,
  "lastUpdated": "2025-12-30T10:30:00Z",
  "name": "Anden",
  "timezone": "America/Denver"
}
---

# Identity
Additional context and notes in markdown...
```

### Memory Tools

| Tool | Description |
|------|-------------|
| `life_read.py` | Read structured data from life files (frontmatter + markdown) |
| `life_write.py` | CRUD operations on frontmatter (set, merge, append, delete) |
| `remember.py` | High-level wrapper for saving facts to life/ |
| `recall.py` | High-level wrapper for searching across life/ folder |
| `mark_question_answered.py` | Track onboarding question progress |
| `update_onboarding_status.py` | Transition onboarding phases |

### Learning Triggers

The life system learns through four distinct mechanisms:

| Trigger | When | What |
|---------|------|------|
| **Continuous** | During conversation | Real-time updates when user shares preferences, contacts, business facts |
| **Explicit** | User command | "Remember this", "Note that", "Don't forget" triggers immediate save |
| **End-of-Conversation** | Session reset/expiry | Reflection prompt reviews conversation for missed learnings |
| **Periodic** | Every 8 hours | Scheduled review of recent conversations (rate-limited 1/12hrs per tenant) |

### Onboarding Flow

New tenants go through a structured onboarding process:

| Phase | Description |
|-------|-------------|
| **DISCOVERY** | Initial phase - ask foundational questions naturally |
| **BUILDING** | Core questions answered - continue passive learning |
| **LIVE** | Onboarding complete - normal operation |

**Commands:**
- `/reonboard` — Reset to DISCOVERY phase
- `/reset` — Clear conversation (triggers end-of-conversation learning first)

### Life Folder Structure

```
tenants/{tenantId}/life/
├── identity.md              # Who the tenant is (name, timezone, preferences)
├── boundaries.md            # Hard rules (never/always/escalate)
├── patterns.md              # Communication and work patterns
├── questions.md             # Pending/answered discovery questions
├── onboarding.md            # Onboarding status and guidance
├── knowledge/
│   ├── business.md          # Business context and facts
│   ├── contacts.md          # Key contacts
│   └── procedures.md        # How they like things done
├── events/
│   └── YYYY-MM.md           # Monthly event logs
└── relationships/
    └── people.md            # Relationship map
```

### Session Flow

1. Claude CLI starts, reads CLAUDE.md (learns the framework)
2. **New session?** Recent messages synced to `state/recent_messages.json` (last 25 messages)
3. If onboarding active, receives onboarding context with current phase
4. Claude reads `state/recent_messages.json` for conversation continuity
5. Claude reads `life/identity.md` (learns who this tenant is)
6. Claude loads relevant knowledge from `life/knowledge/`
7. During conversation, Claude updates life files in real-time
8. For older history, Claude uses `search_history.py` tool
9. On session end, reflection prompt captures any missed learnings

### Context Continuity

The system provides conversation context across session boundaries:

| Source | Purpose | Access |
|--------|---------|--------|
| `state/recent_messages.json` | Last 25 messages (auto-synced on new session) | Direct file read |
| `/api/tools/search-history` | Full history with filtering | Via `search_history.py` tool |

**Search History Filters:**
- `q` - Keyword search in message content
- `direction` - INBOUND or OUTBOUND
- `from` / `to` - Date range (ISO format)
- `limit` / `offset` - Pagination (max 100)

## Project Structure

```
ProxyStaff/
├── src/
│   ├── index.ts                    # Application entry point
│   ├── server.ts                   # Fastify server configuration
│   ├── config/                     # Environment configuration
│   ├── middleware/
│   │   ├── requestId.ts            # UUID per request
│   │   ├── errorHandler.ts         # Global error handling
│   │   └── auth/
│   │       └── whatsappSignature.ts # HMAC-SHA256 verification
│   ├── routes/
│   │   ├── health.ts               # GET /health
│   │   ├── metrics.ts              # GET /metrics
│   │   └── webhooks/
│   │       ├── whatsapp.ts         # WhatsApp webhook handlers
│   │       └── telegram.ts         # Telegram webhook handlers
│   ├── services/
│   │   ├── index.ts                # Service initialization
│   │   ├── claudeCli.ts            # Claude CLI integration
│   │   ├── messageProcessor.ts     # Core message orchestration
│   │   ├── whatsapp.ts             # WhatsApp API client
│   │   ├── messaging/
│   │   │   ├── types.ts            # MessagingService interface
│   │   │   ├── telegram.ts         # Telegram API client
│   │   │   └── resolver.ts         # Per-tenant channel resolver
│   │   ├── learningService.ts      # End-of-conversation + periodic learning
│   │   ├── learningScheduler.ts    # Cron-based periodic learning (every 8h)
│   │   ├── schedulerService.ts     # Cron-based task scheduler
│   │   ├── sessionEndJobProcessor.ts # Background job processor for session-end learning
│   │   ├── tenant.ts               # Tenant resolution
│   │   ├── tenantConfig.ts         # Database configuration
│   │   ├── tenantDirectives.ts     # File-based SOPs
│   │   ├── tenantTools.ts          # Python tool loader
│   │   ├── pythonRunner.ts         # Python subprocess executor
│   │   ├── session.ts              # Conversation sessions
│   │   ├── scheduleParser.ts       # Natural language → cron
│   │   ├── tenantFolder.ts         # Life folder + CLAUDE.md setup
│   │   └── prisma.ts               # Database client singleton
│   ├── tools/
│   │   ├── registry.ts             # Shared tool registration
│   │   ├── getCurrentTime.ts       # Time tool
│   │   ├── searchWeb.ts            # Tavily web search
│   │   ├── searchHistory.ts        # Message history search
│   │   ├── scheduleTask.ts         # Task scheduling
│   │   ├── listSchedules.ts        # List scheduled tasks
│   │   ├── cancelSchedule.ts       # Cancel tasks
│   │   └── readDirective.ts        # Load tenant SOPs
│   ├── types/
│   │   ├── webhook.ts              # WhatsApp payload types
│   │   ├── tenant.ts               # Tenant domain types
│   │   └── fastify.d.ts            # Fastify augmentation
│   ├── utils/
│   │   ├── logger.ts               # Pino logger
│   │   ├── encryption.ts           # Credential encryption
│   │   ├── metrics.ts              # Prometheus metrics
│   │   └── http.ts                 # HTTP utilities
│   ├── errors/                     # Custom error types
│   ├── templates/
│   │   ├── CLAUDE.md               # Universal agent blueprint
│   │   └── life/
│   │       └── onboarding.md       # Onboarding template
│   └── tools/
│       └── python/                 # Shared Python memory tools
│           ├── life_read.py        # Read frontmatter + markdown
│           ├── life_write.py       # CRUD on frontmatter
│           ├── life_schemas.py     # JSON schemas for life files
│           ├── remember.py         # High-level save wrapper
│           ├── recall.py           # High-level search wrapper
│           ├── mark_question_answered.py
│           └── update_onboarding_status.py
├── prisma/
│   ├── schema.prisma               # Database schema
│   └── migrations/                 # Migration history
├── tenants/                        # Tenant-specific files
│   └── {tenantId}/
│       ├── CLAUDE.md               # Universal framework blueprint
│       ├── .env                    # Tenant environment vars
│       ├── life/                   # Permanent memory system
│       │   ├── identity.md         # Who the tenant is
│       │   ├── boundaries.md       # Hard rules (never/always/escalate)
│       │   ├── patterns.md         # Observed patterns
│       │   ├── questions.md        # Discovery questions
│       │   ├── onboarding.md       # Onboarding status + guide
│       │   ├── knowledge/          # Facts and context
│       │   ├── events/             # Event logs
│       │   └── relationships/      # People connections
│       ├── directives/             # SOPs (Markdown)
│       │   ├── README.md           # System prompt
│       │   └── *.md                # Additional SOPs
│       ├── execution/              # Python tools
│       │   ├── tool_manifest.json  # Tool definitions
│       │   └── *.py                # Python scripts
│       └── shared_tools/           # Symlinked framework tools
├── agent-os/                       # Product documentation
│   ├── product/                    # Mission, roadmap, tech-stack
│   └── specs/                      # Feature specifications
└── tests/                          # Test configuration
```

## Database Schema

### Core Models

| Model | Purpose |
|-------|---------|
| **Tenant** | Multi-tenant root entity (status, onboarding) |
| **TenantConfig** | AI configuration (system prompt, enabled tools) |
| **TenantCredential** | Encrypted API keys per service |
| **ConversationSession** | Groups messages by conversation (with lease columns for distributed locking) |
| **Message** | WhatsApp messages with full-text search |
| **ScheduledTask** | Recurring/one-time task scheduling |
| **SessionEndJob** | Background job queue for session-end learning triggers |
| **BrowserSession** | Browser automation session metadata with distributed locking |
| **TenantWorkflow** | n8n workflow integration |
| **WorkflowExecution** | Workflow execution logs |

### Key Indexes

- `(tenant_id, sender_phone, created_at)` - Message history
- `(next_run_at, enabled)` - Scheduler queries
- `search_vector` (GIN) - Full-text message search
- `(tenant_id, sender_phone, ended_at)` - Session lookups
- `(lease_expires_at)` - Distributed lock queries (sessions, browser sessions)
- `(status, created_at)` - Session end job polling

## Multi-Tenancy Model

### Three-Tier Configuration

1. **File-System (Priority)**: `tenants/{tenantId}/directives/README.md`
2. **Database Fallback**: `TenantConfig.system_prompt`
3. **Built-In Security**: Prepended security layer + style suffix

### Tenant Isolation

- **Database**: All tables have `tenant_id` foreign key with cascade delete
- **File System**: Separate `tenants/{tenantId}/` directories
- **Process**: Python tools run in isolated subprocesses
- **Credentials**: Encrypted per-tenant, decrypted on-demand

### Tenant Tool System

```
tenants/{tenantId}/execution/
├── tool_manifest.json    # Tool definitions
│   {
│     "tools": [{
│       "name": "send_email",
│       "description": "Send email via SendGrid",
│       "script": "send_email.py",
│       "input_schema": { ... }
│     }]
│   }
├── send_email.py         # Python implementation
└── .env                  # Tenant credentials
```

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check with version |
| GET | `/metrics` | Prometheus-style metrics |
| GET | `/webhooks/whatsapp` | Meta webhook verification |
| POST | `/webhooks/whatsapp` | WhatsApp message handler |
| POST | `/webhooks/telegram` | Telegram message handler |
| GET | `/api/tools/search-history` | Search conversation history (with filtering) |
| POST | `/api/tools/schedule-task` | Create scheduled task |
| GET | `/api/tools/list-schedules` | List tenant's scheduled tasks |
| POST | `/api/tools/cancel-schedule` | Cancel a scheduled task |

### WhatsApp Webhook Security

1. **Verification** (GET): Token comparison against `WHATSAPP_VERIFY_TOKEN`
2. **Authorization** (POST): HMAC-SHA256 signature via `X-Hub-Signature-256`

## Message Processing Flow

```
1. WhatsApp → POST /webhooks/whatsapp
2. Signature verification (HMAC-SHA256)
3. Tenant resolution by phone_number_id
4. Return 200 immediately (Meta requirement)
5. Async processing:
   ├── Get/create conversation session
   ├── Load tenant config (folder → database)
   ├── Build tools (tenant + shared)
   ├── Load message history
   ├── Claude API call with tools
   ├── Execute tool calls (Python/shared)
   ├── Send WhatsApp response
   └── Store messages in database
```

## Scheduled Tasks

### Task Types

- **reminder**: Send text message to user
- **execute**: Run tools and perform actions

### Distributed Execution

- PostgreSQL advisory locks prevent multi-instance conflicts
- Lease-based claiming (50 tasks/tick, 300s TTL)
- Automatic retry with exponential backoff
- Task disabling after 3 consecutive failures

### Schedule Parsing

Supports natural language:
- "every day at 9am" → cron expression
- "tomorrow at 3pm" → one-time Date
- "weekly on Monday" → cron expression

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Environment (development/production) |
| `DATABASE_URL` | PostgreSQL connection string |
| `CREDENTIALS_ENCRYPTION_KEY` | 32+ char encryption key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token |
| `WHATSAPP_APP_SECRET` | HMAC signature secret |
| `WHATSAPP_ACCESS_TOKEN` | Meta API token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp business phone ID |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `LOG_LEVEL` | info | Pino log level |
| `SESSION_TIMEOUT_HOURS` | 24 | Conversation session timeout in hours |
| `TAVILY_API_KEY` | - | Web search API |
| `TELEGRAM_BOT_TOKEN` | - | Telegram Bot API token (from @BotFather) |

## Deployment (Railway)

ProxyStaff is designed to deploy on Railway with PostgreSQL and Redis:

### Services Required

| Service | Purpose |
|---------|---------|
| **ProxyStaff** | Main app (Dockerfile) |
| **PostgreSQL** | Database |
| **Redis** | BullMQ async task queue |

### Environment Variables

Set these in Railway Variables:
- `DATABASE_URL` - Reference PostgreSQL service
- `REDIS_URL` - Reference Redis service
- `ANTHROPIC_API_KEY` - Claude API key
- All other required env vars from `.env.example`

### Persistent Storage

**Important:** Add a Railway volume mounted at `/app/tenants` (1GB is sufficient for 30+ tenants).
This persists the tenant folders (life/, state/, history/) across deploys.

### Health Check

- Path: `/health`
- Timeout: 120 seconds (allows for Prisma migrations on startup)

## Quick Start

```bash
# Clone and install
git clone https://github.com/andenwick/ProxyStaff.git
cd ProxyStaff
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start PostgreSQL (Docker)
docker run -d --name proxystaff-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=proxystaff \
  -p 5432:5432 postgres:15

# Run migrations and start
npx prisma migrate deploy
npm run dev
```

## Development

### Setup

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev

# Start development server
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Development with hot reload |
| `npm run build` | TypeScript compilation |
| `npm start` | Production server |
| `npm test` | Run Jest tests |
| `npm run typecheck` | Type checking |
| `npm run lint` | ESLint |

### Cloudflare Tunnel

A named Cloudflare tunnel is preconfigured for webhook testing:

| Setting | Value |
|---------|-------|
| Hostname | `n8n.aspenautomations.com` |
| Routes to | `http://localhost:3000` |
| Config | `~/.cloudflared/config.yml` |

**Start the tunnel:**
```bash
cloudflared tunnel run
```

This provides a stable public URL for WhatsApp/Telegram webhook callbacks during development.

> **Note:** Quick/temporary tunnels are also available via `.\scripts\start-cloudflared.ps1` but the named tunnel above is preferred for consistent webhook URLs.

### Adding a Tenant Tool

1. Create Python script in `tenants/{tenantId}/execution/`
2. Add tool definition to `tool_manifest.json`
3. Add credentials to `tenants/{tenantId}/.env`

## Security Features

### Prompt Injection Protection

- Immutable security layer prefix
- Identity assertion directives
- Role-play prevention
- Manipulation resistance

### WhatsApp Style Enforcement

- 1-3 short sentences max
- No markdown/formatting
- Casual conversational tone

### Tool Usage Guard

Prevents Claude from falsely claiming tool execution when no tools were used.

## Metrics

### Counters

- `messages_inbound` - Incoming messages by tenant
- `messages_processed` - Processing status
- `claude_requests` - API call status
- `whatsapp_requests` - Message send status
- `scheduled_tasks` - Task execution status

### Timings

- `message_processing_ms` - End-to-end latency
- `claude_request_ms` - AI response time
- `whatsapp_request_ms` - Message delivery time

## License

Proprietary - All rights reserved.
