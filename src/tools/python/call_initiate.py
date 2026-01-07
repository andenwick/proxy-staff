#!/usr/bin/env python3
"""
call_initiate.py - Initiate a phone call via Twilio

Input JSON:
{
    "to": "+1234567890",
    "script": "Optional script/notes for the call",
    "record": false
}

Output JSON:
{
    "status": "success|failed",
    "call_id": "CA...",
    "message": "Call initiated"
}

Note: This creates a call from your Twilio number to the target.
For sales calls, consider using Twilio's TwiML for call flow.

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
        script = input_data.get("script", "")
        record = input_data.get("record", False)

        if not to_number:
            raise ValueError("Missing required field: to")

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

            # Create a simple TwiML response that says a message
            # In production, you'd host TwiML on a server for more complex flows
            twiml_url = os.environ.get("TWILIO_TWIML_URL")

            if not twiml_url:
                # Without a TwiML URL, we can't control the call flow
                # Just initiate a simple call that plays a message
                result = {
                    "status": "failed",
                    "error": "TWILIO_TWIML_URL not configured. Automated calls require a TwiML endpoint to control call flow."
                }
                print(json.dumps(result))
                sys.exit(1)

            call_params = {
                "to": to_number,
                "from_": from_number,
                "url": twiml_url,
            }

            if record:
                call_params["record"] = True

            call = client.calls.create(**call_params)

            result = {
                "status": "success",
                "call_id": call.sid,
                "message": f"Call initiated to {to_number}",
                "script": script if script else None
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
