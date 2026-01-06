#!/usr/bin/env python3
"""
Shared tool: update_directive
Updates an existing directive (SOP) markdown file in the tenant's directives folder.

Input (JSON via stdin):
{
    "name": "email_summary",  # Filename without .md extension
    "content": "# Updated Email Summary SOP\n\n## Goal\n...",  # New markdown content
    "backup": true  # Optional, default true - create backup before update
}

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Directive updated successfully",
    "path": "directives/email_summary.md",
    "backup_path": ".backups/directives/email_summary_20231215_143022.md",
    "error": null | "error message"
}

This tool runs in the tenant folder context (cwd = tenants/{tenant_id}/).
It creates a backup before overwriting (configurable).
It will NOT modify README.md (the system prompt) - that is protected.
"""

import sys
import json
import os
import re
import shutil
from datetime import datetime


def validate_name(name: str) -> tuple[bool, str]:
    """Validate directive name (alphanumeric + underscore only)."""
    if not name:
        return False, "Name cannot be empty"

    if name.lower() == "readme":
        return False, "Cannot modify README.md - it is the protected system prompt"

    if not re.match(r'^[a-zA-Z][a-zA-Z0-9_]*$', name):
        return False, "Name must start with a letter and contain only letters, numbers, and underscores"

    if len(name) > 50:
        return False, "Name must be 50 characters or less"

    return True, ""


def ensure_backup_directory():
    """Ensure backup directory exists."""
    os.makedirs(os.path.join(".backups", "directives"), exist_ok=True)


def create_backup(directive_path: str, name: str) -> str:
    """Create a backup of the existing directive. Returns backup path."""
    ensure_backup_directory()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"{name}_{timestamp}.md"
    backup_path = os.path.join(".backups", "directives", backup_filename)

    shutil.copy2(directive_path, backup_path)

    # Clean up old backups (keep last 3)
    cleanup_old_backups(name)

    return backup_path


def cleanup_old_backups(name: str, keep_count: int = 3):
    """Keep only the most recent backups for a directive."""
    backup_dir = os.path.join(".backups", "directives")
    if not os.path.exists(backup_dir):
        return

    # Find all backups for this directive
    pattern = re.compile(rf'^{re.escape(name)}_\d{{8}}_\d{{6}}\.md$')
    backups = []

    for filename in os.listdir(backup_dir):
        if pattern.match(filename):
            filepath = os.path.join(backup_dir, filename)
            backups.append((filepath, os.path.getmtime(filepath)))

    # Sort by modification time (newest first)
    backups.sort(key=lambda x: x[1], reverse=True)

    # Delete old backups
    for filepath, _ in backups[keep_count:]:
        try:
            os.remove(filepath)
        except Exception:
            pass  # Ignore cleanup errors


def main():
    # Read JSON input from stdin
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Validate required fields
    name = input_data.get("name", "").strip()
    content = input_data.get("content", "")
    should_backup = input_data.get("backup", True)

    if not name:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "error": "Missing required field: name"
        }))
        sys.exit(1)

    if not content:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
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
            "backup_path": None,
            "error": error_msg
        }))
        sys.exit(1)

    # Build file path
    directive_path = os.path.join("directives", f"{name}.md")

    # Check if file exists
    if not os.path.exists(directive_path):
        print(json.dumps({
            "success": False,
            "message": None,
            "path": directive_path,
            "backup_path": None,
            "error": f"Directive '{name}' does not exist. Use create_directive to create it."
        }))
        sys.exit(1)

    # Create backup if requested
    backup_path = None
    if should_backup:
        try:
            backup_path = create_backup(directive_path, name)
        except Exception as e:
            print(json.dumps({
                "success": False,
                "message": None,
                "path": directive_path,
                "backup_path": None,
                "error": f"Failed to create backup: {str(e)}"
            }))
            sys.exit(1)

    # Write the updated directive
    try:
        with open(directive_path, "w", encoding="utf-8") as f:
            f.write(content)

        print(json.dumps({
            "success": True,
            "message": f"Directive '{name}' updated successfully",
            "path": directive_path,
            "backup_path": backup_path,
            "error": None
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": directive_path,
            "backup_path": backup_path,
            "error": f"Failed to write directive: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
