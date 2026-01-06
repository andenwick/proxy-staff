#!/usr/bin/env python3
"""
log_decision.py - Log a decision to the tenant's history/decisions.log file.

This is an append-only log for audit purposes.

Input JSON:
{
    "category": "ACTION" | "ESCALATION" | "BOUNDARY" | "STATE_CHANGE",
    "description": "What was decided and why"
}

Output JSON:
{
    "status": "success",
    "file": "history/decisions.log",
    "message": "Decision logged successfully"
}
"""

import sys
import json
from datetime import datetime
from pathlib import Path


VALID_CATEGORIES = ["ACTION", "ESCALATION", "BOUNDARY", "STATE_CHANGE"]


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        category = input_data.get("category")
        description = input_data.get("description")

        if not category:
            raise ValueError("Missing required field: category")
        if not description:
            raise ValueError("Missing required field: description")

        if category not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category: {category}. Must be one of: {', '.join(VALID_CATEGORIES)}")

        # Ensure history directory exists
        history_dir = Path("history")
        history_dir.mkdir(parents=True, exist_ok=True)

        file_path = history_dir / "decisions.log"

        # Create file with header if it doesn't exist
        if not file_path.exists():
            header = """# Decision Log
# Format: [TIMESTAMP] [CATEGORY] Decision description
# Categories: ACTION, ESCALATION, BOUNDARY, STATE_CHANGE

"""
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(header)

        # Format the log entry
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{category}] {description}\n"

        # Append to log
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(entry)

        result = {
            "status": "success",
            "file": str(file_path),
            "message": "Decision logged successfully"
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
