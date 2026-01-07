#!/usr/bin/env python3
"""
Shared tool: schedule_task
Schedules a task to run at a specific time or on a recurring schedule.

Input (JSON via stdin):
{
    "task": "Task description",
    "schedule": "every day at 9am",
    "task_type": "reminder" | "execute",  # optional, default: "reminder"
    "timezone": "America/Denver"  # optional
}

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Task scheduled successfully!",
    "task_id": "uuid" | null,
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
            "task_id": None,
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
            "task_id": None,
            "error": "Missing required environment variables: TENANT_ID, SENDER_PHONE"
        }))
        sys.exit(1)

    # Validate input
    task = input_data.get("task")
    schedule = input_data.get("schedule")

    if not task or not schedule:
        print(json.dumps({
            "success": False,
            "message": None,
            "task_id": None,
            "error": "Missing required fields: task, schedule"
        }))
        sys.exit(1)

    # Build request payload
    payload = {
        "tenantId": tenant_id,
        "senderPhone": sender_phone,
        "task": task,
        "schedule": schedule,
        "taskType": input_data.get("task_type", "reminder"),
        "timezone": input_data.get("timezone", "America/Denver")
    }

    # Make API request
    try:
        url = f"{api_base_url}/api/tools/schedule-task"
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
            "message": result.get("message", "Task scheduled successfully!"),
            "task_id": result.get("taskId"),
            "error": None
        }))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(json.dumps({
            "success": False,
            "message": None,
            "task_id": None,
            "error": f"API error ({e.code}): {error_body}"
        }))
        sys.exit(1)

    except urllib.error.URLError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "task_id": None,
            "error": f"Connection error: {str(e.reason)}"
        }))
        sys.exit(1)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "task_id": None,
            "error": f"Unexpected error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
