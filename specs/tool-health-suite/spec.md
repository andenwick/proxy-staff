# Tool Health Test Suite Specification

## Overview
Automated health checking system for tenant tools that validates tool configurations, executes test runs, alerts on failures, and queues self-healing fix tasks.

## Goals
1. Ensure all tenant tools have proper test configurations
2. Periodically verify tools are operational
3. Alert administrators when tools fail
4. Enable the agent to self-heal broken tools

## Key Features

### 1. Tool Manifest Validation
Each tool in a tenant's tool manifest must have one of:
- `test_input`: JSON object with test parameters
- `skip_test: true`: For destructive or side-effect tools
- `test_chain`: For tools that depend on output from another tool

### 2. Health Check Execution
- Discover all tenants with tool folders
- Load and parse tool manifest JSON files
- Execute each tool with its test input
- Track pass/fail/skip results

### 3. Chain Resolution
Tools with `test_chain` configuration:
- Run the dependency tool first
- Extract output using lodash `get()` path
- Map extracted value to input parameter

### 4. Alerting
On tool failure:
- Send Telegram notification to admin
- Include tool name, tenant ID, truncated error

### 5. Fix Task Queueing
On tool failure:
- Create async_job record in database
- Include diagnostic prompt for self-healing

### 6. Scheduling
- Startup health check (30 seconds delay)
- Periodic health check (every 6 hours via cron)
- On-demand via API endpoint

## API

### POST /admin/tools/health-check
- Requires: `Authorization: Bearer <ADMIN_API_KEY>`
- Body (optional): `{ "tenantId": "specific-tenant" }`
- Returns: `{ passed, failed, skipped, results[] }`

## Configuration

### Environment Variables
- `TELEGRAM_BOT_TOKEN`: Bot token for alerting
- `ADMIN_TELEGRAM_CHAT_ID`: Chat ID for alert notifications
- `ADMIN_API_KEY`: API key for admin endpoints

## Files
- `src/services/toolHealthService.ts`: Core service
- `src/routes/admin.ts`: API endpoint
- `src/services/index.ts`: Service initialization and cron
- `src/index.ts`: Startup health check
