#!/usr/bin/env python3
"""
update_onboarding_status.py - Update the onboarding status.

This tool updates the local onboarding.md file. The server will sync
this status to the database automatically.

Input JSON:
{
    "status": "discovery|building|live|paused",
    "reason": "Optional reason for the change"
}

Output JSON:
{
    "status": "success",
    "message": "Onboarding status updated to BUILDING",
    "previous_status": "discovery",
    "new_status": "building"
}
"""

import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path


VALID_STATUSES = ["discovery", "building", "live", "paused"]


def call_life_read(file_name: str) -> dict:
    """Call life_read.py to get current data."""
    script_path = Path(__file__).parent / "life_read.py"

    input_data = {"file": file_name}

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            return {"status": "error", "data": {}}

    except Exception as e:
        return {"status": "error", "message": str(e), "data": {}}


def call_life_write(file_name: str, operation: str, path: str | None, value) -> dict:
    """Call life_write.py with the given parameters."""
    script_path = Path(__file__).parent / "life_write.py"

    input_data = {
        "file": file_name,
        "operation": operation,
        "value": value
    }
    if path:
        input_data["path"] = path

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            try:
                return json.loads(result.stdout)
            except:
                return {"status": "error", "message": result.stderr or "Unknown error"}

    except Exception as e:
        return {"status": "error", "message": str(e)}


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        new_status = input_data.get("status", "").lower()
        reason = input_data.get("reason", "")

        if not new_status:
            raise ValueError("Missing required field: status")

        if new_status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {new_status}. Must be one of: {VALID_STATUSES}")

        # Read current onboarding data
        current = call_life_read("onboarding.md")
        current_data = current.get("data", {})
        previous_status = current_data.get("status", "discovery")

        # Prepare update
        update_data = {
            "status": new_status,
            "statusChangedAt": datetime.utcnow().isoformat() + "Z"
        }

        # Set timestamps based on status transition
        if new_status == "discovery" and previous_status != "discovery":
            update_data["startedAt"] = datetime.utcnow().isoformat() + "Z"
            update_data["completedAt"] = None
        elif new_status == "live" and previous_status != "live":
            update_data["completedAt"] = datetime.utcnow().isoformat() + "Z"

        if reason:
            update_data["statusChangeReason"] = reason

        # Update onboarding.md
        result = call_life_write("onboarding.md", "merge", None, update_data)

        if result.get("status") != "success":
            print(json.dumps(result))
            sys.exit(1)

        # Also write a sync marker that the server can pick up
        sync_file = Path("life") / ".onboarding_sync"
        sync_file.write_text(json.dumps({
            "status": new_status.upper(),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }))

        print(json.dumps({
            "status": "success",
            "message": f"Onboarding status updated to {new_status.upper()}",
            "previous_status": previous_status,
            "new_status": new_status
        }))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
