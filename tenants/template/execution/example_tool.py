#!/usr/bin/env python3
"""
Example tool script following the stdin/stdout contract.

This script demonstrates the required pattern for tenant execution scripts:
1. Read JSON input from stdin
2. Process the input (call APIs, query databases, etc.)
3. Print result to stdout (plain text or JSON)
4. Exit 0 on success, non-zero on error

Environment variables from the tenant's .env file are automatically loaded.
"""

import sys
import json
import os


def main():
    try:
        # Read JSON input from stdin
        input_data = json.loads(sys.stdin.read())

        # Extract parameters from input
        # Example: order_id = input_data.get("order_id")
        message = input_data.get("message", "Hello from example tool!")

        # Access environment variables (loaded from tenant's .env)
        # Example: api_key = os.environ.get("MY_API_KEY")

        # Perform the tool's action
        # This is where you would call external APIs, query databases, etc.
        result = {
            "status": "success",
            "message": message,
            "note": "This is an example tool response"
        }

        # Output result to stdout
        print(json.dumps(result))

    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON input - {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
