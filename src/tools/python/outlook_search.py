#!/usr/bin/env python3
"""
Shared tool: outlook_search
Search emails in the user's Outlook inbox.

Input (JSON via stdin):
{
    "query": "from:someone@example.com",  # optional search query
    "folder": "inbox",                     # optional, default: inbox
    "limit": 10                            # optional, max results (default: 10)
}

Output (JSON to stdout):
{
    "success": true/false,
    "emails": [...],
    "count": 5,
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
        input_data = {}

    tenant_id = os.environ.get("TENANT_ID")
    api_base_url = os.environ.get("API_BASE_URL", "http://localhost:3000")

    if not tenant_id:
        print(json.dumps({
            "success": False,
            "emails": [],
            "count": 0,
            "error": "TENANT_ID environment variable not set"
        }))
        sys.exit(1)

    try:
        # Build request
        url = f"{api_base_url}/api/internal/outlook/search"
        payload = {
            "tenant_id": tenant_id,
            "query": input_data.get("query"),
            "folder": input_data.get("folder", "inbox"),
            "limit": input_data.get("limit", 10)
        }

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
                "emails": result.get("emails", []),
                "count": result.get("count", 0),
                "error": None
            }))
        else:
            print(json.dumps({
                "success": False,
                "emails": [],
                "count": 0,
                "error": result.get("error", "Unknown error")
            }))
            sys.exit(1)

    except urllib.error.HTTPError as e:
        print(json.dumps({
            "success": False,
            "emails": [],
            "count": 0,
            "error": f"HTTP error {e.code}: {e.reason}"
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "emails": [],
            "count": 0,
            "error": f"Failed to search emails: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
