#!/usr/bin/env python3
"""
Shared tool: manage_trigger
Enable, disable, or delete a workflow trigger.

Input (JSON via stdin):
{
    "trigger_id": "uuid",
    "action": "enable" | "disable" | "delete"
}

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Trigger enabled successfully",
    "error": null | "error message"
}

Environment variables required:
- TENANT_ID: The tenant ID
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
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Get required environment variables
    api_base_url = os.environ.get("API_BASE_URL", "http://localhost:3000")

    # Validate input
    trigger_id = input_data.get("trigger_id")
    action = input_data.get("action")

    if not trigger_id or not action:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": "Missing required fields: trigger_id, action"
        }))
        sys.exit(1)

    # Validate action
    valid_actions = ["enable", "disable", "delete"]
    if action not in valid_actions:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": f"Invalid action. Must be one of: {', '.join(valid_actions)}"
        }))
        sys.exit(1)

    # Build request payload
    payload = {
        "trigger_id": trigger_id,
        "action": action
    }

    # Make API request
    try:
        url = f"{api_base_url}/api/tools/manage-trigger"
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
            "message": result.get("message", f"Trigger {action}d successfully"),
            "error": None
        }))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(json.dumps({
            "success": False,
            "message": None,
            "error": f"API error ({e.code}): {error_body}"
        }))
        sys.exit(1)

    except urllib.error.URLError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": f"Connection error: {str(e.reason)}"
        }))
        sys.exit(1)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": f"Unexpected error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
