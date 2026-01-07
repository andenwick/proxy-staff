#!/usr/bin/env python3
"""
sms_send.py - Send SMS message via Twilio

Input JSON:
{
    "to": "+1234567890",
    "body": "Message text"
}

Output JSON:
{
    "status": "success|failed",
    "message_id": "SM...",
    "message": "SMS sent successfully"
}

Requires:
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER
"""

import sys
import json
from pathlib import Path


def load_env_from_cwd():
    """Load .env file from current working directory."""
    env_path = Path.cwd() / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                import os
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main():
    try:
        load_env_from_cwd()

        import os

        input_data = json.loads(sys.stdin.read())

        to_number = input_data.get("to")
        body = input_data.get("body")

        if not to_number:
            raise ValueError("Missing required field: to")
        if not body:
            raise ValueError("Missing required field: body")

        # Check for Twilio credentials
        account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
        auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
        from_number = os.environ.get("TWILIO_PHONE_NUMBER")

        if not account_sid or not auth_token or not from_number:
            result = {
                "status": "failed",
                "error": "Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env"
            }
            print(json.dumps(result))
            sys.exit(1)

        # Try to use Twilio SDK
        try:
            from twilio.rest import Client

            client = Client(account_sid, auth_token)

            message = client.messages.create(
                body=body,
                from_=from_number,
                to=to_number
            )

            result = {
                "status": "success",
                "message_id": message.sid,
                "message": f"SMS sent to {to_number}"
            }
            print(json.dumps(result))

        except ImportError:
            # Twilio SDK not installed
            result = {
                "status": "failed",
                "error": "Twilio SDK not installed. Run: pip install twilio"
            }
            print(json.dumps(result))
            sys.exit(1)

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
