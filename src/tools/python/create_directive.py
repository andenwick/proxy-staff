#!/usr/bin/env python3
"""
Shared tool: create_directive
Creates a new directive (SOP) markdown file in the tenant's directives folder.

Input (JSON via stdin):
{
    "name": "email_summary",  # Filename without .md extension
    "content": "# Email Summary SOP\n\n## Goal\n..."  # Markdown content
}

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Directive created successfully",
    "path": "directives/email_summary.md",
    "error": null | "error message"
}

This tool runs in the tenant folder context (cwd = tenants/{tenant_id}/).
It will NOT overwrite existing files - use update_directive.py for that.
It will NOT modify README.md (the system prompt) - that is protected.
"""

import sys
import json
import os
import re
from datetime import datetime


def validate_name(name: str) -> tuple[bool, str]:
    """Validate directive name (alphanumeric + underscore only)."""
    if not name:
        return False, "Name cannot be empty"

    if name.lower() == "readme":
        return False, "Cannot create/modify README.md - it is the protected system prompt"

    if not re.match(r'^[a-zA-Z][a-zA-Z0-9_]*$', name):
        return False, "Name must start with a letter and contain only letters, numbers, and underscores"

    if len(name) > 50:
        return False, "Name must be 50 characters or less"

    return True, ""


def ensure_directories():
    """Ensure directives and backup directories exist."""
    os.makedirs("directives", exist_ok=True)
    os.makedirs(os.path.join(".backups", "directives"), exist_ok=True)


def main():
    # Read JSON input from stdin
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Validate required fields
    name = input_data.get("name", "").strip()
    content = input_data.get("content", "")

    if not name:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "error": "Missing required field: name"
        }))
        sys.exit(1)

    if not content:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "error": "Missing required field: content"
        }))
        sys.exit(1)

    # Validate name format
    valid, error_msg = validate_name(name)
    if not valid:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "error": error_msg
        }))
        sys.exit(1)

    # Ensure directories exist
    try:
        ensure_directories()
    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "error": f"Failed to create directories: {str(e)}"
        }))
        sys.exit(1)

    # Build file path
    directive_path = os.path.join("directives", f"{name}.md")

    # Check if file already exists
    if os.path.exists(directive_path):
        print(json.dumps({
            "success": False,
            "message": None,
            "path": directive_path,
            "error": f"Directive '{name}' already exists. Use update_directive to modify it."
        }))
        sys.exit(1)

    # Write the directive file
    try:
        with open(directive_path, "w", encoding="utf-8") as f:
            f.write(content)

        print(json.dumps({
            "success": True,
            "message": f"Directive '{name}' created successfully",
            "path": directive_path,
            "error": None
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "error": f"Failed to write directive: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
