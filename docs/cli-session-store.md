# CLI Session Store

The CLI Session Store (`src/services/queue/cliSessionStore.ts`) manages persistent Claude CLI sessions for multi-message conversations.

## Overview

Instead of spawning a new CLI process for each message, the session store maintains long-running CLI processes that can handle multiple messages per user. This enables:

- **Conversation continuity** - Claude maintains context across messages
- **Message queuing** - New messages queue while CLI is processing
- **Lower latency** - No CLI startup overhead after first message

## How It Works

### Session Creation

```
User sends message → MessageProcessor → cliSessionStore.createSession()
                                              ↓
                                      Spawn CLI with stream-json mode
                                              ↓
                                      Wait 500ms for CLI to initialize
                                              ↓
                                      Return session handle
```

### Message Flow

```
New message → injectMessage(session, message)
                    ↓
            Is CLI processing? ──Yes──→ Queue message (pendingMessages)
                    │
                   No
                    ↓
            Send to CLI stdin (JSON format)
                    ↓
            Wait for result message on stdout
                    ↓
            Return response
                    ↓
            Process next queued message (if any)
```

## CLI Spawn Arguments

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --session-id <unique-id> \
  --setting-sources user,project,local \
  --dangerously-skip-permissions
```

## Key Implementation Details

### Session ID Generation

Session IDs must be **unique per spawn** to avoid "Session ID already in use" errors:

```typescript
// Uses DB session ID + timestamp for uniqueness
const cliSessionId = generateCliSessionId(dbSessionId, Date.now());
```

### Stream-JSON Protocol

- **Input**: NDJSON messages to stdin
- **Output**: NDJSON responses from stdout
- **Important**: CLI does NOT send an init message until it receives input

### Message Format (Input)

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "Hello, Claude!"
  }
}
```

### Result Format (Output)

```json
{
  "type": "result",
  "subtype": "success",
  "result": "Hello! How can I help you today?"
}
```

## Gotchas

### 1. No Init Message in Stream-JSON Mode

The CLI does **not** output an init message when started in stream-json mode. It waits for input first. Don't wait for init - just give CLI time to start (500ms) then send messages.

### 2. Session ID Collisions

If Railway restarts the container, the CLI session files may persist but the old process is dead. Using the same session ID will fail with "Session ID already in use". Fix: include timestamp in session ID.

### 3. Error Messages Not Stored

When message processing fails, the error message is sent to the user but **not stored** in the messages table. Check logs for "Failed to process message" entries.

### 4. Container Shutdown During Init

If Railway sends SIGTERM while CLI is initializing, the init will timeout. This is normal during deploys - the next request will succeed.

## Debug Scripts

```bash
# View recent messages from production DB
node scripts/show-messages.js

# View recent async jobs
node scripts/show-jobs.js
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENANT_ID` | Passed to CLI for tenant context |
| `SENDER_PHONE` | User's phone number |
| `API_BASE_URL` | Base URL for tool callbacks |

## Related Files

- `src/services/queue/cliSessionStore.ts` - Session management
- `src/services/claudeCli.ts` - Session ID generation, one-shot CLI calls
- `src/services/messageProcessor.ts` - Message orchestration
