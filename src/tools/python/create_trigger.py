#!/usr/bin/env python3
"""
Shared tool: create_trigger
Creates a workflow trigger that fires on events, webhooks, conditions, or schedules.

Input (JSON via stdin):
{
    "name": "My Trigger",
    "description": "Optional description",
    "trigger_type": "WEBHOOK" | "CONDITION" | "EVENT" | "TIME",
    "config": { ... },  // Type-specific config (see below)
    "task_prompt": "What Claude should do when triggered",
    "autonomy": "NOTIFY" | "CONFIRM" | "AUTO",  // optional, default: NOTIFY
    "cooldown_seconds": 0  // optional, min time between executions
}

Config by trigger_type:
- WEBHOOK: { "signature_type": "hmac-sha256", "signature_header": "x-signature" }
- CONDITION: { "poll_interval_minutes": 5, "data_source": { "type": "http", "url": "..." }, "condition": { "expression": "value < 100" } }
- EVENT: { "event_source": "email", "event_type": "received", "filters": { "from": "..." } }
- TIME: { "cron_expr": "0 9 * * *", "timezone": "America/Denver" }

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Trigger created successfully",
    "trigger_id": "uuid" | null,
    "webhook_url": "https://..." | null,  // For WEBHOOK type
    "error": null | "error message"
}

Environment variables required:
- TENANT_ID: The tenant ID
- SENDER_PHONE: The phone number of the user
- API_BASE_URL: The server API base URL (default: http://localhost:3000)
"""

import sys
import json
import os
import urllib.request
import urllib.error


def main():
    # Read JSON input from stdin
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Get required environment variables
    tenant_id = os.environ.get("TENANT_ID")
    sender_phone = os.environ.get("SENDER_PHONE")
    api_base_url = os.environ.get("API_BASE_URL", "http://localhost:3000")

    if not tenant_id or not sender_phone:
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": "Missing required environment variables: TENANT_ID, SENDER_PHONE"
        }))
        sys.exit(1)

    # Validate input
    name = input_data.get("name")
    trigger_type = input_data.get("trigger_type")
    config = input_data.get("config", {})
    task_prompt = input_data.get("task_prompt")

    if not name or not trigger_type or not task_prompt:
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": "Missing required fields: name, trigger_type, task_prompt"
        }))
        sys.exit(1)

    # Validate trigger_type
    valid_types = ["WEBHOOK", "CONDITION", "EVENT", "TIME"]
    if trigger_type not in valid_types:
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": f"Invalid trigger_type. Must be one of: {', '.join(valid_types)}"
        }))
        sys.exit(1)

    # Build request payload
    payload = {
        "tenant_id": tenant_id,
        "sender_phone": sender_phone,
        "name": name,
        "description": input_data.get("description"),
        "trigger_type": trigger_type,
        "config": config,
        "task_prompt": task_prompt,
        "autonomy": input_data.get("autonomy", "NOTIFY"),
        "cooldown_seconds": input_data.get("cooldown_seconds", 0)
    }

    # Make API request
    try:
        url = f"{api_base_url}/api/tools/create-trigger"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        print(json.dumps({
            "success": True,
            "message": result.get("message", "Trigger created successfully"),
            "trigger_id": result.get("trigger_id"),
            "webhook_url": result.get("webhook_url"),
            "error": None
        }))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": f"API error ({e.code}): {error_body}"
        }))
        sys.exit(1)

    except urllib.error.URLError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": f"Connection error: {str(e.reason)}"
        }))
        sys.exit(1)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "trigger_id": None,
            "webhook_url": None,
            "error": f"Unexpected error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
