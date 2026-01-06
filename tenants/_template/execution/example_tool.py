#!/usr/bin/env python3
"""Example tool that echoes input. Replace with your own implementation."""

import json
import sys


def main():
    # Read input from stdin
    input_data = json.loads(sys.stdin.read())
    message = input_data.get("message", "")

    # Process and return result
    result = {"echo": message, "status": "success"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
