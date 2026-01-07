#!/usr/bin/env python3
"""
timeline_search.py - Search timeline journals for events.

Input JSON:
{
    "query": "search term",           # optional - keyword search
    "date": "2026-01-06",             # optional - specific date
    "from": "2026-01-01",             # optional - date range start
    "to": "2026-01-06",               # optional - date range end
    "type": "MESSAGE|TOOL|SCHEDULED", # optional - event type filter
    "limit": 20                       # optional - max results (default 20)
}

Output JSON:
{
    "status": "success",
    "events": [...],
    "total": 42
}
"""

import sys
import json
import re
from pathlib import Path
from datetime import datetime, timedelta


def parse_date(date_str: str) -> datetime:
    """Parse YYYY-MM-DD string to datetime."""
    return datetime.strptime(date_str, "%Y-%m-%d")


def get_date_range(params: dict) -> tuple[datetime, datetime]:
    """Get date range from params, defaulting to today."""
    today = datetime.now().date()

    if "date" in params:
        d = parse_date(params["date"]).date()
        return d, d

    start = parse_date(params["from"]).date() if "from" in params else today - timedelta(days=7)
    end = parse_date(params["to"]).date() if "to" in params else today

    return start, end


def parse_timeline_file(filepath: Path) -> list[dict]:
    """
    Parse a timeline markdown file into event entries.

    Expected format:
    ### HH:MM:SS [TYPE] Description
    Content line 1
    Content line 2

    ---
    """
    events = []

    if not filepath.exists():
        return events

    content = filepath.read_text(encoding="utf-8")
    date_str = filepath.stem  # YYYY-MM-DD from filename

    # Pattern to match event headers: ### HH:MM:SS [TYPE] description
    event_pattern = re.compile(
        r'^### (\d{2}:\d{2}:\d{2}) \[([A-Z]+)\] (.+?)$',
        re.MULTILINE
    )

    # Split by separator
    blocks = content.split("---")

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        match = event_pattern.search(block)
        if match:
            time_str = match.group(1)
            event_type = match.group(2)
            header = match.group(3)

            # Get content after the header line
            lines = block.split("\n")
            content_lines = []
            header_found = False
            for line in lines:
                if header_found and line.strip():
                    content_lines.append(line.strip())
                if line.startswith("###"):
                    header_found = True

            event = {
                "date": date_str,
                "time": time_str,
                "type": event_type,
                "header": header,
                "content": "\n".join(content_lines) if content_lines else ""
            }
            events.append(event)

    return events


def search_events(events: list[dict], query: str | None, event_type: str | None) -> list[dict]:
    """Filter events by query and type."""
    results = []

    for event in events:
        # Filter by type
        if event_type and event["type"] != event_type:
            continue

        # Filter by query
        if query:
            query_lower = query.lower()
            searchable = f"{event['header']} {event['content']}".lower()
            if query_lower not in searchable:
                continue

        results.append(event)

    return results


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        query = input_data.get("query")
        event_type = input_data.get("type")
        limit = input_data.get("limit", 20)

        # Get date range
        start_date, end_date = get_date_range(input_data)

        # Find timeline folder
        timeline_dir = Path("timeline")

        if not timeline_dir.exists():
            result = {
                "status": "success",
                "events": [],
                "total": 0,
                "message": "No timeline folder found"
            }
            print(json.dumps(result))
            return

        # Collect all events in date range
        all_events = []
        current = start_date
        while current <= end_date:
            filename = f"{current.strftime('%Y-%m-%d')}.md"
            filepath = timeline_dir / filename
            events = parse_timeline_file(filepath)
            all_events.extend(events)
            current += timedelta(days=1)

        # Search/filter events
        filtered = search_events(all_events, query, event_type)

        # Sort by date/time (most recent first)
        filtered.sort(key=lambda e: f"{e['date']} {e['time']}", reverse=True)

        # Apply limit
        limited = filtered[:limit] if limit else filtered

        result = {
            "status": "success",
            "events": limited,
            "total": len(filtered),
            "returned": len(limited),
            "date_range": {
                "from": start_date.strftime("%Y-%m-%d"),
                "to": end_date.strftime("%Y-%m-%d")
            }
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
