#!/usr/bin/env python3
"""
Shared tool: get_current_time
Gets the current time in a specified timezone.

Input (JSON via stdin):
{
    "timezone": "America/Denver"  # optional, default: "America/Denver"
}

Output (JSON to stdout):
{
    "success": true/false,
    "time": "2024-01-15 10:30:45",
    "timezone": "America/Denver",
    "error": null | "error message"
}

No environment variables required for this tool.
"""

import sys
import json
from datetime import datetime

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo


def main():
    # Read JSON input from stdin
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        # Default to empty object if no input
        input_data = {}

    # Get timezone from input or use default
    timezone = input_data.get("timezone", "America/Denver")

    try:
        # Get current time in specified timezone
        tz = ZoneInfo(timezone)
        now = datetime.now(tz)

        print(json.dumps({
            "success": True,
            "time": now.strftime("%Y-%m-%d %H:%M:%S"),
            "timezone": timezone,
            "error": None
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "time": None,
            "timezone": timezone,
            "error": f"Failed to get time: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
