# ProxyStaff Operations Runbook

Internal guide for setting up and managing customer tenants.

## Customer Setup Checklist

### Quick Setup (Single Command)
```bash
npx tsx scripts/setup-customer.ts --name "Business Name" --phone "+18015551234" --channel telegram
```

### Full Setup (With Config File)
```bash
# 1. Create intake file from template
cp docs/customer-intake-template.json customers/new-customer.json

# 2. Edit with customer details
# - name, phone, channel
# - business info (industry, location, hours)
# - credentials (API keys)

# 3. Run setup
npx tsx scripts/setup-customer.ts --from-file customers/new-customer.json

# 4. Validate
npx tsx scripts/validate-tenant.ts <tenant-uuid>
```

### Manual Setup (Step by Step)
```bash
# 1. Create database record
npx tsx scripts/create-tenant.ts

# 2. Initialize folder
npx tsx scripts/init-tenant.ts <tenant-uuid>

# 3. Set credentials via Admin API
curl -X POST https://your-domain/admin/tenants/<id>/credentials \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"credentials": {"SENDGRID_API_KEY": "sg-xxx"}}'

# 4. Validate
npx tsx scripts/validate-tenant.ts <tenant-uuid>
```

---

## Adding Credentials

### Via Admin API (Recommended for Production)
```bash
curl -X POST https://your-domain/admin/tenants/<tenant-id>/credentials \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": {
      "SENDGRID_API_KEY": "sg-xxx",
      "GOOGLE_CREDENTIALS_JSON": "{...}"
    }
  }'
```

### Via Direct File Edit (Local Only)
```bash
# Edit tenants/<tenant-id>/.env
SENDGRID_API_KEY=sg-xxx
GOOGLE_CREDENTIALS_JSON={"type":"service_account",...}
```

### Common Credentials
| Service | Key | How to Get |
|---------|-----|------------|
| SendGrid | `SENDGRID_API_KEY` | SendGrid Dashboard > Settings > API Keys |
| Google | `GOOGLE_CREDENTIALS_JSON` | GCP Console > Service Account > Keys |
| Gmail OAuth | `GMAIL_REFRESH_TOKEN` | Run `scripts/google-oauth.py` |

---

## Linking Customer Accounts

### Telegram
Customer sends this message to your bot:
```
/start +18015551234
```
(Replace with their phone number from the tenant record)

### WhatsApp
Customer sends any message from their WhatsApp number. System auto-links based on phone.

---

## Common Issues & Solutions

### "No account found for this chat"
**Cause:** Telegram chat not linked to tenant.
**Fix:**
```sql
UPDATE tenants SET telegram_chat_id = 'CHAT_ID' WHERE phone_number = '+1xxx';
```
Or have customer send `/start +PHONE_NUMBER` again.

### Agent not responding
**Cause:** Session lease stuck or CLI crashed.
**Fix:**
```bash
# Check recent logs
railway logs --lines 100 -s ProxyStaff | grep -i error

# If lease stuck, wait 5 minutes or restart
railway service restart -s ProxyStaff
```

### Tool not working
**Cause:** Missing credentials or Python script error.
**Check:**
1. Credentials set? `GET /admin/tenants/<id>/credentials`
2. Script has `load_env_from_cwd()`? Check the Python file.
3. Tool health: `POST /admin/tools/health-check`

### "Credit balance too low"
**Cause:** Claude CLI using API credits instead of Max plan.
**Fix:** Re-authenticate Max plan credentials:
```bash
# On Railway container
railway ssh -s ProxyStaff
cat /home/nodejs/.claude/.credentials.json
# If empty or invalid, re-run setup-token locally and copy
```

---

## Monitoring

### Health Check
```bash
curl https://your-domain/health
```

### View Recent Logs
```bash
railway logs --lines 100 -s ProxyStaff
```

### Check Tenant Status
```bash
node scripts/read-tenant.js <tenant-id>
```

### View Recent Messages
```bash
node scripts/read-messages.js
```

---

## Railway Commands

```bash
# View logs
railway logs --lines 100 -s ProxyStaff

# SSH into container
railway ssh -s ProxyStaff

# Restart service
railway service restart -s ProxyStaff

# Check variables
railway variables -s ProxyStaff

# Run DB migration
railway run -s ProxyStaff "npx prisma migrate deploy"
```

---

## Database Operations

### Direct DB Access
```bash
# Connect via Railway
railway connect -s Postgres

# Or use connection string from docs/railway-connection.md
```

### Common Queries
```sql
-- List all tenants
SELECT id, name, phone_number, status, onboarding_status FROM tenants;

-- Check tenant messages
SELECT * FROM messages WHERE tenant_id = 'xxx' ORDER BY created_at DESC LIMIT 20;

-- Check scheduled tasks
SELECT * FROM scheduled_tasks WHERE tenant_id = 'xxx' AND status = 'PENDING';

-- Fix stuck session lease
UPDATE conversation_sessions SET lease_expires_at = NULL WHERE tenant_id = 'xxx';
```

---

## Escalation Procedures

### Customer Complaint
1. Check recent messages in DB
2. Review timeline file: `tenants/<id>/timeline/YYYY-MM-DD.md`
3. If agent error, check logs for stack trace
4. If persistent, reset session: customer sends `/reset`

### System Down
1. Check Railway status: https://status.railway.app
2. Check logs for crash reason
3. If OOM, increase memory in Railway
4. If DB issue, check Postgres metrics

### Data Recovery
```bash
# If tenant folder corrupted
npx tsx scripts/init-tenant.ts <tenant-id>  # Re-copies from template
# Note: This overwrites execution/ but preserves nothing else
```

---

## Tenant Lifecycle

| Status | Meaning | Next Step |
|--------|---------|-----------|
| DISCOVERY | Agent gathering business info | Let agent ask questions |
| BUILDING | Agent learning passively | Normal operation |
| LIVE | Full autonomous operation | Normal operation |
| PAUSED | Temporarily disabled | Update status to LIVE |

### Change Status
```sql
UPDATE tenants SET onboarding_status = 'LIVE' WHERE id = 'xxx';
```

---

## Security Notes

- Never commit `.env` files
- Admin API requires `ADMIN_API_KEY` header
- Credentials encrypted with AES-256-GCM
- Tenant folders are isolated by ID
- Rate limit: 60 messages/min per phone number
