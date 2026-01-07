#!/usr/bin/env python3
"""
list_pending_actions.py - List pending actions awaiting approval

Input JSON:
{
    "campaign_id": "optional campaign filter",
    "include_expired": false
}

Output JSON:
{
    "status": "success",
    "count": 5,
    "pending": [
        {
            "id": "uuid",
            "campaign_name": "Q1 Outreach",
            "target_name": "John Smith",
            "action_type": "send_email",
            "subject": "Quick question",
            "body_preview": "Hi John...",
            "queued_at": "2026-01-06T12:00:00Z",
            "expires_in": "2 days"
        }
    ]
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


def format_time_remaining(expires_at: str) -> str:
    """Format time remaining until expiry."""
    expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    now = datetime.now(expires.tzinfo)

    diff = expires - now
    if diff.total_seconds() <= 0:
        return "expired"

    days = diff.days
    hours = diff.seconds // 3600

    if days > 0:
        return f"{days} day{'s' if days > 1 else ''}"
    elif hours > 0:
        return f"{hours} hour{'s' if hours > 1 else ''}"
    else:
        minutes = diff.seconds // 60
        return f"{minutes} minute{'s' if minutes > 1 else ''}"


def main():
    try:
        input_data = {}
        stdin_content = sys.stdin.read().strip()
        if stdin_content:
            input_data = json.loads(stdin_content)

        campaign_id = input_data.get("campaign_id")
        include_expired = input_data.get("include_expired", False)

        data = load_pending_approvals()
        now = datetime.utcnow()

        pending = []
        for action in data.get("pending", []):
            # Skip non-pending status
            if action.get("status") != "pending":
                continue

            # Check expiry
            expires_at = action.get("expires_at", "")
            if expires_at:
                expires = datetime.fromisoformat(expires_at.replace("Z", ""))
                if expires <= now and not include_expired:
                    continue

            # Filter by campaign if specified
            if campaign_id and action.get("campaign_id") != campaign_id:
                continue

            # Format for output
            body = action.get("body", "")
            body_preview = body[:100] + "..." if len(body) > 100 else body

            pending.append({
                "id": action["id"],
                "campaign_id": action.get("campaign_id"),
                "campaign_name": action.get("campaign_name", ""),
                "target_id": action.get("target_id"),
                "target_name": action.get("target_name", "Unknown"),
                "target_email": action.get("target_email"),
                "action_type": action.get("action_type"),
                "channel": action.get("channel"),
                "subject": action.get("subject"),
                "body_preview": body_preview,
                "reasoning": action.get("reasoning"),
                "queued_at": action.get("queued_at"),
                "expires_in": format_time_remaining(expires_at) if expires_at else "unknown"
            })

        result = {
            "status": "success",
            "count": len(pending),
            "pending": pending
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
