#!/usr/bin/env python3
"""
Shared tool: list_triggers
Lists all workflow triggers for the current user.

Input (JSON via stdin):
{
    "all_users": false  // optional, if true lists all triggers for tenant
}

Output (JSON to stdout):
{
    "success": true/false,
    "triggers": [
        {
            "id": "uuid",
            "name": "My Trigger",
            "description": "...",
            "trigger_type": "WEBHOOK",
            "autonomy": "NOTIFY",
            "status": "ACTIVE",
            "task_prompt": "...",
            "webhook_url": "https://...",
            "last_triggered_at": "2024-01-01T12:00:00Z",
            "created_at": "2024-01-01T10:00:00Z"
        }
    ],
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
    except json.JSONDecodeError:
        input_data = {}

    # Get required environment variables
    tenant_id = os.environ.get("TENANT_ID")
    sender_phone = os.environ.get("SENDER_PHONE")
    api_base_url = os.environ.get("API_BASE_URL", "http://localhost:3000")

    if not tenant_id or not sender_phone:
        print(json.dumps({
            "success": False,
            "triggers": [],
            "error": "Missing required environment variables: TENANT_ID, SENDER_PHONE"
        }))
        sys.exit(1)

    # Build query string
    all_users = input_data.get("all_users", False)
    query_params = f"tenant_id={tenant_id}"
    if not all_users:
        query_params += f"&sender_phone={sender_phone}"

    # Make API request
    try:
        url = f"{api_base_url}/api/tools/list-triggers?{query_params}"
        req = urllib.request.Request(url, method="GET")

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        print(json.dumps({
            "success": True,
            "triggers": result.get("triggers", []),
            "error": None
        }))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(json.dumps({
            "success": False,
            "triggers": [],
            "error": f"API error ({e.code}): {error_body}"
        }))
        sys.exit(1)

    except urllib.error.URLError as e:
        print(json.dumps({
            "success": False,
            "triggers": [],
            "error": f"Connection error: {str(e.reason)}"
        }))
        sys.exit(1)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "triggers": [],
            "error": f"Unexpected error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
