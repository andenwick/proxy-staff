#!/usr/bin/env python3
"""
log_event.py - Log an event to the tenant's life/events/ folder.

Events are stored in monthly files (e.g., 2025-12.md).

Input JSON:
{
    "event": "Description of what happened",
    "importance": "high|medium|low"  // Optional, defaults to "medium"
}

Output JSON:
{
    "status": "success",
    "file": "life/events/2025-12.md",
    "message": "Event logged successfully"
}
"""

import sys
import json
from datetime import datetime
from pathlib import Path


def get_importance_marker(importance: str) -> str:
    """Get a visual marker for importance level."""
    markers = {
        "high": "[!]",
        "medium": "[-]",
        "low": "[.]"
    }
    return markers.get(importance, "[-]")


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        event = input_data.get("event")
        importance = input_data.get("importance", "medium")

        if not event:
            raise ValueError("Missing required field: event")

        if importance not in ["high", "medium", "low"]:
            importance = "medium"

        # Get current month's file
        now = datetime.now()
        events_dir = Path("life") / "events"
        events_dir.mkdir(parents=True, exist_ok=True)

        file_name = now.strftime("%Y-%m.md")
        file_path = events_dir / file_name

        # Format the event entry
        timestamp = now.strftime("%Y-%m-%d %H:%M")
        marker = get_importance_marker(importance)
        entry = f"\n{marker} **{timestamp}** - {event}\n"

        # Check if file exists, create header if new
        if not file_path.exists():
            header = f"# Events - {now.strftime('%B %Y')}\n"
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(header)

        # Append event
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(entry)

        result = {
            "status": "success",
            "file": str(file_path),
            "message": "Event logged successfully"
        }
        print(json.dumps(result))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
