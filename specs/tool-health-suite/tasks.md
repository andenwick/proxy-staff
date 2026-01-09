# Tool Health Test Suite - Tasks

## Task Group 1: Test Input Schema and Manifest Validation
- [x] Add `test_input`, `skip_test`, and `test_chain` fields to tool manifest schema
- [x] Implement `validateToolManifest()` function
- [x] Update tenant tool JSON files with test configurations
- [x] Create template pattern in `tenants/_template/execution/tools/utility_tools.json`

## Task Group 2: ToolHealthService Core
- [x] Implement `ToolHealthService` class
- [x] Create `discoverTenants()` method to find tenant folders with tools
- [x] Create `loadTenantTools()` method to load and parse tool manifests
- [x] Create `testTool()` method to execute tools with test input
- [x] Implement chain resolution for `test_chain` dependencies
- [x] Create `runFullSuite()` method for comprehensive health checks

## Task Group 3: Alerting and Fix Task Queueing
- [x] Implement `alertFailure()` method for Telegram notifications
- [x] Implement `queueFixTask()` method to create async_jobs records
- [x] Alert messages include tool name, tenant ID, and truncated error
- [x] Fix prompts include instructions for checking code and credentials

## Task Group 4: API Endpoint and Scheduler Integration
- [x] Add `POST /admin/tools/health-check` endpoint
- [x] Endpoint requires admin authentication
- [x] Supports optional `tenantId` body parameter for filtering
- [x] Integrate `getToolHealthService()` export
- [x] Schedule 6-hour cron job for periodic health checks
- [x] Add startup health check (30 seconds after startup)

## Task Group 5: End-to-End Verification
- [x] Create unit tests for ToolHealthService (14 tests)
- [x] Create API integration tests (4 tests)
- [x] Verify all tests pass
