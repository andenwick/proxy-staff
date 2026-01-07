#!/usr/bin/env python3
"""
approve_actions.py - Approve pending actions for execution

Input JSON:
{
    "action_ids": ["uuid1", "uuid2"],  # Specific actions to approve
    "approve_all": false,              # Or approve all pending
    "campaign_id": "optional filter"   # Filter for approve_all
}

Output JSON:
{
    "status": "success",
    "approved_count": 3,
    "message": "3 actions approved for execution"
}
"""

import sys
import json
from pathlib import Path
from datetime import datetime


def load_pending_approvals() -> dict:
    """Load pending approvals file."""
    file_path = Path("state") / "pending_approvals.json"

    if not file_path.exists():
        return {
            "version": 1,
            "pending": [],
            "history": []
        }

    return json.loads(file_path.read_text(encoding="utf-8"))


def save_pending_approvals(data: dict):
    """Save pending approvals file."""
    file_path = Path("state") / "pending_approvals.json"
    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"
    file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main():
    try:
        input_data = {}
        stdin_content = sys.stdin.read().strip()
        if stdin_content:
            input_data = json.loads(stdin_content)

        action_ids = input_data.get("action_ids", [])
        approve_all = input_data.get("approve_all", False)
        campaign_id = input_data.get("campaign_id")

        if not action_ids and not approve_all:
            raise ValueError("Must provide action_ids or set approve_all=true")

        data = load_pending_approvals()
        now = datetime.utcnow()
        approved_count = 0

        for action in data.get("pending", []):
            # Skip non-pending
            if action.get("status") != "pending":
                continue

            # Check if expired
            expires_at = action.get("expires_at", "")
            if expires_at:
                expires = datetime.fromisoformat(expires_at.replace("Z", ""))
                if expires <= now:
                    continue

            # Check filters
            should_approve = False
            if approve_all:
                if campaign_id:
                    should_approve = action.get("campaign_id") == campaign_id
                else:
                    should_approve = True
            else:
                should_approve = action["id"] in action_ids

            if should_approve:
                action["status"] = "approved"
                action["approved_at"] = now.isoformat() + "Z"

                # Add to history
                data["history"].insert(0, {
                    "id": action["id"],
                    "action_type": action.get("action_type"),
                    "target_name": action.get("target_name"),
                    "status": "approved",
                    "approved_at": action["approved_at"]
                })

                approved_count += 1

        # Keep history manageable
        if len(data["history"]) > 500:
            data["history"] = data["history"][:500]

        save_pending_approvals(data)

        result = {
            "status": "success",
            "approved_count": approved_count,
            "message": f"{approved_count} action{'s' if approved_count != 1 else ''} approved for execution"
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
