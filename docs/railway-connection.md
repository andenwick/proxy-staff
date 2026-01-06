# Railway Database Connection

## Public URL (for local access)
```
postgresql://postgres:REDACTED_DB_PASSWORD@caboose.proxy.rlwy.net:13874/railway
```

## Internal URL (only works inside Railway)
```
postgresql://postgres:REDACTED_DB_PASSWORD@postgres.railway.internal:5432/railway
```

## Usage
```bash
DATABASE_URL="postgresql://postgres:REDACTED_DB_PASSWORD@caboose.proxy.rlwy.net:13874/railway" node scripts/read-messages.js
```
