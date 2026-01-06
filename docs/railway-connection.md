# Railway Database Connection

## Public URL (for local access)
```
postgresql://postgres:ijkXDkbZwqRgkahwTThMdcYaYTNBHBLr@caboose.proxy.rlwy.net:13874/railway
```

## Internal URL (only works inside Railway)
```
postgresql://postgres:ijkXDkbZwqRgkahwTThMdcYaYTNBHBLr@postgres.railway.internal:5432/railway
```

## Usage
```bash
DATABASE_URL="postgresql://postgres:ijkXDkbZwqRgkahwTThMdcYaYTNBHBLr@caboose.proxy.rlwy.net:13874/railway" node scripts/read-messages.js
```
