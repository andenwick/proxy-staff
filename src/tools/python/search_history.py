#!/usr/bin/env python3
"""
Shared tool: search_history
Searches conversation history for the current user.

Input (JSON via stdin):
{
    "query": "search term",      # optional - keyword search
    "direction": "INBOUND",      # optional - INBOUND or OUTBOUND
    "from": "2026-01-01",        # optional - start date (ISO format)
    "to": "2026-01-06",          # optional - end date (ISO format)
    "limit": 20,                 # optional, default: 20, max: 100
    "offset": 0                  # optional, for pagination
}

Output (JSON to stdout):
{
    "success": true/false,
    "messages": [...],
    "total": 150,
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
import urllib.parse


def main():
    # Read JSON input from stdin
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "messages": [],
            "total": 0,
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Get required environment variables
    tenant_id = os.environ.get("TENANT_ID")
    api_base_url = os.environ.get("API_BASE_URL", "http://localhost:3000")

    if not tenant_id:
        print(json.dumps({
            "success": False,
            "messages": [],
            "total": 0,
            "error": "Missing required environment variable: TENANT_ID"
        }))
        sys.exit(1)

    # Build query params
    params = {"tenant_id": tenant_id}

    # Optional filters
    if input_data.get("query"):
        params["q"] = input_data["query"]

    if input_data.get("direction"):
        params["direction"] = input_data["direction"]

    if input_data.get("from"):
        params["from"] = input_data["from"]

    if input_data.get("to"):
        params["to"] = input_data["to"]

    params["limit"] = str(input_data.get("limit", 20))
    params["offset"] = str(input_data.get("offset", 0))

    # Make API request
    try:
        query_string = urllib.parse.urlencode(params)
        url = f"{api_base_url}/api/tools/search-history?{query_string}"
        req = urllib.request.Request(url, method="GET")

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        # Format messages for easy reading
        messages = result.get("messages", [])
        formatted = []
        for msg in messages:
            formatted.append({
                "timestamp": msg.get("created_at"),
                "direction": msg.get("direction"),
                "content": msg.get("content"),
                "phone": msg.get("sender_phone")
            })

        print(json.dumps({
            "success": True,
            "messages": formatted,
            "total": result.get("total", len(messages)),
            "error": None
        }))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(json.dumps({
            "success": False,
            "messages": [],
            "total": 0,
            "error": f"API error ({e.code}): {error_body}"
        }))
        sys.exit(1)

    except urllib.error.URLError as e:
        print(json.dumps({
            "success": False,
            "messages": [],
            "total": 0,
            "error": f"Connection error: {str(e.reason)}"
        }))
        sys.exit(1)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "messages": [],
            "total": 0,
            "error": f"Unexpected error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
