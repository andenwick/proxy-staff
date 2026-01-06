#!/usr/bin/env python3
"""
read_state.py - Read a state file from the tenant's state/ folder.

Input JSON:
{
    "file": "current" | "clients" | "calendar"
}

Output JSON:
{
    "status": "success",
    "file": "state/current.json",
    "data": { ... contents of the file ... }
}
"""

import sys
import json
from pathlib import Path


VALID_FILES = {
    "current": "current.json",
    "clients": "clients.json",
    "calendar": "calendar.json",
}


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        file_key = input_data.get("file")

        if not file_key:
            raise ValueError("Missing required field: file")

        if file_key not in VALID_FILES:
            raise ValueError(f"Invalid file: {file_key}. Must be one of: {', '.join(VALID_FILES.keys())}")

        file_name = VALID_FILES[file_key]
        file_path = Path("state") / file_name

        if not file_path.exists():
            raise FileNotFoundError(f"State file not found: {file_path}")

        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        result = {
            "status": "success",
            "file": str(file_path),
            "data": data
        }
        print(json.dumps(result, indent=2))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
