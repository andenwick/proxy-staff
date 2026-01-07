#!/usr/bin/env python3
"""
execute_approved_actions.py - Execute approved actions

This tool executes all approved actions, calling the appropriate
channel tools (send_email, linkedin_send, etc.)

Input JSON:
{
    "action_ids": ["uuid1"],  # Optional: specific actions to execute
    "dry_run": false          # If true, don't actually send
}

Output JSON:
{
    "status": "success",
    "executed": 3,
    "failed": 0,
    "results": [
        {"action_id": "uuid", "status": "success", "message_id": "..."},
        {"action_id": "uuid", "status": "failed", "error": "..."}
    ]
}
"""

import sys
import json
import subprocess
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


def execute_email(action: dict) -> dict:
    """Execute email send action."""
    # Call send_email.py
    email_input = {
        "to": action.get("target_email"),
        "subject": action.get("subject", ""),
        "body": action.get("body", "")
    }

    try:
        result = subprocess.run(
            ["python", str(Path(__file__).parent / "send_email.py")],
            input=json.dumps(email_input),
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            output = json.loads(result.stdout)
            if output.get("status") == "success":
                return {
                    "status": "success",
                    "message_id": output.get("message_id")
                }
            else:
                return {
                    "status": "failed",
                    "error": output.get("message", "Unknown error")
                }
        else:
            return {
                "status": "failed",
                "error": result.stderr or "Email send failed"
            }
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Timeout sending email"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def execute_linkedin(action: dict) -> dict:
    """Execute LinkedIn action."""
    # Call linkedin_send.py
    linkedin_input = {
        "profile_url": action.get("target_linkedin"),
        "message": action.get("body", "")
    }

    try:
        result = subprocess.run(
            ["python", str(Path(__file__).parent / "linkedin_send.py")],
            input=json.dumps(linkedin_input),
            capture_output=True,
            text=True,
            timeout=120
        )

        if result.returncode == 0:
            output = json.loads(result.stdout)
            return output
        else:
            return {
                "status": "failed",
                "error": result.stderr or "LinkedIn send failed"
            }
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Timeout sending LinkedIn message"}
    except FileNotFoundError:
        return {"status": "failed", "error": "LinkedIn tool not available"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def execute_sms(action: dict) -> dict:
    """Execute SMS action."""
    sms_input = {
        "to": action.get("target_phone"),
        "body": action.get("body", "")
    }

    try:
        result = subprocess.run(
            ["python", str(Path(__file__).parent / "sms_send.py")],
            input=json.dumps(sms_input),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            output = json.loads(result.stdout)
            return output
        else:
            return {
                "status": "failed",
                "error": result.stderr or "SMS send failed"
            }
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Timeout sending SMS"}
    except FileNotFoundError:
        return {"status": "failed", "error": "SMS tool not available"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def execute_action(action: dict, dry_run: bool = False) -> dict:
    """Execute a single action."""
    action_type = action.get("action_type", "")
    channel = action.get("channel", "")

    if dry_run:
        return {
            "status": "success",
            "dry_run": True,
            "message": f"Would execute {action_type} to {action.get('target_name')}"
        }

    if action_type == "send_email" or channel == "email":
        return execute_email(action)
    elif action_type == "send_linkedin" or channel == "linkedin":
        return execute_linkedin(action)
    elif action_type == "send_sms" or channel == "sms":
        return execute_sms(action)
    elif action_type == "call" or channel == "call":
        return {"status": "failed", "error": "Call execution not yet implemented"}
    else:
        return {"status": "failed", "error": f"Unknown action type: {action_type}"}


def main():
    try:
        input_data = {}
        stdin_content = sys.stdin.read().strip()
        if stdin_content:
            input_data = json.loads(stdin_content)

        action_ids = input_data.get("action_ids", [])
        dry_run = input_data.get("dry_run", False)

        data = load_pending_approvals()
        now = datetime.utcnow()

        results = []
        executed = 0
        failed = 0

        for action in data.get("pending", []):
            # Only process approved actions
            if action.get("status") != "approved":
                continue

            # Filter by action_ids if specified
            if action_ids and action["id"] not in action_ids:
                continue

            # Execute the action
            exec_result = execute_action(action, dry_run)

            result_entry = {
                "action_id": action["id"],
                "target_name": action.get("target_name"),
                "action_type": action.get("action_type"),
                **exec_result
            }
            results.append(result_entry)

            if exec_result.get("status") == "success":
                executed += 1
                if not dry_run:
                    # Mark as executed
                    action["status"] = "executed"
                    action["executed_at"] = now.isoformat() + "Z"

                    # Update history
                    for h in data["history"]:
                        if h["id"] == action["id"]:
                            h["status"] = "executed"
                            h["executed_at"] = action["executed_at"]
                            break
            else:
                failed += 1
                if not dry_run:
                    # Keep as approved for retry, but log error
                    action["last_error"] = exec_result.get("error")
                    action["last_attempt"] = now.isoformat() + "Z"

        # Remove executed from pending
        if not dry_run:
            data["pending"] = [a for a in data["pending"] if a.get("status") != "executed"]
            save_pending_approvals(data)

        result = {
            "status": "success",
            "executed": executed,
            "failed": failed,
            "dry_run": dry_run,
            "results": results
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
