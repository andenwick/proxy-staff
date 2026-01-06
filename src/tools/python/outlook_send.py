#!/usr/bin/env python3
"""
Shared tool: outlook_send
Send an email or reply to an existing email via Outlook.

Input (JSON via stdin):
{
    "to": "recipient@example.com",      # required (string or array)
    "subject": "Email subject",          # required
    "body": "Email body text",           # required
    "reply_to_id": "message_id"          # optional - if set, replies to this message
}

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Email sent successfully",
    "error": null | "error message"
}

Environment variables required:
- TENANT_ID: The tenant ID
- API_BASE_URL: The base URL of the ProxyStaff API
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
        print(json.dumps({
            "success": False,
            "message": None,
            "error": "Invalid JSON input"
        }))
        sys.exit(1)

    tenant_id = os.environ.get("TENANT_ID")
    api_base_url = os.environ.get("API_BASE_URL", "http://localhost:3000")

    if not tenant_id:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": "TENANT_ID environment variable not set"
        }))
        sys.exit(1)

    # Validate required fields
    to = input_data.get("to")
    subject = input_data.get("subject")
    body = input_data.get("body")

    if not to or not subject or not body:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": "Missing required fields: to, subject, body"
        }))
        sys.exit(1)

    try:
        # Build request
        url = f"{api_base_url}/api/internal/outlook/send"
        payload = {
            "tenant_id": tenant_id,
            "to": to,
            "subject": subject,
            "body": body
        }

        if input_data.get("reply_to_id"):
            payload["reply_to_id"] = input_data["reply_to_id"]

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        if result.get("success"):
            print(json.dumps({
                "success": True,
                "message": result.get("message", "Email sent successfully"),
                "error": None
            }))
        else:
            print(json.dumps({
                "success": False,
                "message": None,
                "error": result.get("error", "Unknown error")
            }))
            sys.exit(1)

    except urllib.error.HTTPError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": f"HTTP error {e.code}: {e.reason}"
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "error": f"Failed to send email: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
