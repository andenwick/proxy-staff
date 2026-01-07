#!/usr/bin/env python3
"""
queue_action.py - Add action to approval queue

Input JSON:
{
    "campaign_id": "uuid",
    "campaign_name": "campaign-name",
    "target_id": "uuid",
    "target_name": "John Smith",
    "target_email": "john@example.com",
    "target_linkedin": "linkedin.com/in/john",
    "target_phone": "+1234567890",
    "action_type": "send_email|send_linkedin|send_sms|call",
    "channel": "email|linkedin|sms|call",
    "subject": "Email subject (for email)",
    "body": "Message body",
    "reasoning": "Why this action"
}

Output JSON:
{
    "status": "success",
    "action_id": "uuid",
    "message": "Action queued for approval"
}
"""

import sys
import json
import uuid
from pathlib import Path
from datetime import datetime, timedelta


def load_pending_approvals() -> dict:
    """Load pending approvals file."""
    state_dir = Path("state")
    file_path = state_dir / "pending_approvals.json"

    if not file_path.exists():
        state_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 1,
            "lastUpdated": datetime.utcnow().isoformat() + "Z",
            "pending": [],
            "history": []
        }
        save_pending_approvals(data)
        return data

    return json.loads(file_path.read_text(encoding="utf-8"))


def save_pending_approvals(data: dict):
    """Save pending approvals file."""
    file_path = Path("state") / "pending_approvals.json"
    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"
    file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        # Validate required fields
        required = ["campaign_id", "target_id", "target_name", "action_type", "body"]
        for field in required:
            if not input_data.get(field):
                raise ValueError(f"Missing required field: {field}")

        data = load_pending_approvals()

        now = datetime.utcnow()
        expires = now + timedelta(days=3)  # 3 day expiry

        action = {
            "id": str(uuid.uuid4()),
            "campaign_id": input_data["campaign_id"],
            "campaign_name": input_data.get("campaign_name", ""),
            "target_id": input_data["target_id"],
            "target_name": input_data["target_name"],
            "target_email": input_data.get("target_email"),
            "target_linkedin": input_data.get("target_linkedin"),
            "target_phone": input_data.get("target_phone"),
            "action_type": input_data["action_type"],
            "channel": input_data.get("channel", input_data["action_type"].replace("send_", "")),
            "subject": input_data.get("subject"),
            "body": input_data["body"],
            "reasoning": input_data.get("reasoning", ""),
            "queued_at": now.isoformat() + "Z",
            "expires_at": expires.isoformat() + "Z",
            "status": "pending"
        }

        data["pending"].append(action)
        save_pending_approvals(data)

        result = {
            "status": "success",
            "action_id": action["id"],
            "message": f"Action queued for approval (expires in 3 days)"
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
