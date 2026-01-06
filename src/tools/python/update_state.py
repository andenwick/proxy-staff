#!/usr/bin/env python3
"""
update_state.py - Update a state file in the tenant's state/ folder.

Input JSON:
{
    "file": "current" | "clients" | "calendar",
    "operation": "set" | "append" | "remove",
    "path": "activeTasks",  // JSON path (dot notation for nested: "workingHours.start")
    "value": { ... }  // Value to set/append (not needed for remove)
}

Operations:
- "set": Replace the value at path with the new value
- "append": Append value to array at path
- "remove": Remove item from array at path (value should be the item to remove or index)

Output JSON:
{
    "status": "success",
    "file": "state/current.json",
    "message": "State updated successfully"
}
"""

import sys
import json
from datetime import datetime
from pathlib import Path


VALID_FILES = {
    "current": "current.json",
    "clients": "clients.json",
    "calendar": "calendar.json",
}


def get_nested(data: dict, path: str):
    """Get a nested value using dot notation path."""
    keys = path.split(".")
    for key in keys:
        if isinstance(data, dict):
            data = data.get(key)
        elif isinstance(data, list) and key.isdigit():
            data = data[int(key)]
        else:
            return None
    return data


def set_nested(data: dict, path: str, value):
    """Set a nested value using dot notation path."""
    keys = path.split(".")
    for key in keys[:-1]:
        if key not in data:
            data[key] = {}
        data = data[key]
    data[keys[-1]] = value


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        file_key = input_data.get("file")
        operation = input_data.get("operation")
        path = input_data.get("path")
        value = input_data.get("value")

        if not file_key:
            raise ValueError("Missing required field: file")
        if not operation:
            raise ValueError("Missing required field: operation")
        if not path:
            raise ValueError("Missing required field: path")
        if operation in ["set", "append"] and value is None:
            raise ValueError("Missing required field: value for set/append operation")

        if file_key not in VALID_FILES:
            raise ValueError(f"Invalid file: {file_key}. Must be one of: {', '.join(VALID_FILES.keys())}")

        if operation not in ["set", "append", "remove"]:
            raise ValueError(f"Invalid operation: {operation}. Must be one of: set, append, remove")

        file_name = VALID_FILES[file_key]
        file_path = Path("state") / file_name

        if not file_path.exists():
            raise FileNotFoundError(f"State file not found: {file_path}")

        # Read current state
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Perform operation
        if operation == "set":
            set_nested(data, path, value)
        elif operation == "append":
            target = get_nested(data, path)
            if not isinstance(target, list):
                raise ValueError(f"Path '{path}' is not an array, cannot append")
            target.append(value)
        elif operation == "remove":
            target = get_nested(data, path)
            if not isinstance(target, list):
                raise ValueError(f"Path '{path}' is not an array, cannot remove")
            if isinstance(value, int):
                # Remove by index
                if 0 <= value < len(target):
                    target.pop(value)
                else:
                    raise ValueError(f"Index {value} out of range")
            else:
                # Remove by value
                if value in target:
                    target.remove(value)
                else:
                    # Try to remove by matching id field for objects
                    for i, item in enumerate(target):
                        if isinstance(item, dict) and item.get("id") == value:
                            target.pop(i)
                            break

        # Update lastUpdated timestamp
        data["lastUpdated"] = datetime.now().isoformat()

        # Write back
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        result = {
            "status": "success",
            "file": str(file_path),
            "message": "State updated successfully"
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
