#!/usr/bin/env python3
"""
Shared tool: update_tool
Updates an existing Python execution tool in the tenant's execution folder.

Input (JSON via stdin):
{
    "name": "fetch_weather",
    "description": "Updated description",  # Optional - only updates manifest if provided
    "script_content": "#!/usr/bin/env python3\\nimport sys...",
    "input_schema": {"type": "object", "properties": {...}},  # Optional
    "test_input": {"city": "Denver"}  # Optional - run test before deployment
}

Output (JSON to stdout):
{
    "success": true/false,
    "message": "Tool updated successfully",
    "path": "execution/fetch_weather.py",
    "backup_path": ".backups/tools/fetch_weather_20231215_143022.py",
    "manifest_updated": true/false,
    "test_result": {...},
    "error": null | "error message"
}

This tool runs in the tenant folder context (cwd = tenants/{tenant_id}/).
It creates a backup before overwriting and keeps only the last 3 backups.
It validates Python syntax and basic JSON contract before deployment.
"""

import sys
import json
import os
import re
import ast
import subprocess
import shutil
from datetime import datetime


def validate_name(name: str) -> tuple[bool, str]:
    """Validate tool name (alphanumeric + underscore only)."""
    if not name:
        return False, "Name cannot be empty"

    if not re.match(r'^[a-zA-Z][a-zA-Z0-9_]*$', name):
        return False, "Name must start with a letter and contain only letters, numbers, and underscores"

    if len(name) > 50:
        return False, "Name must be 50 characters or less"

    return True, ""


def validate_python_syntax(script_content: str) -> tuple[bool, str]:
    """Validate Python syntax using ast.parse()."""
    try:
        ast.parse(script_content)
        return True, ""
    except SyntaxError as e:
        return False, f"Python syntax error at line {e.lineno}: {e.msg}"


def check_json_contract(script_content: str) -> tuple[bool, str]:
    """Check script has basic stdin JSON read and stdout print patterns."""
    # Check for stdin read pattern
    stdin_patterns = [
        'sys.stdin.read()',
        'json.load(sys.stdin)',
        'stdin.read()',
    ]
    has_stdin = any(pattern in script_content for pattern in stdin_patterns)

    # Check for json.loads or json.load
    has_json_parse = 'json.load' in script_content

    # Check for print with json.dumps
    has_json_output = 'json.dumps' in script_content and 'print' in script_content

    if not has_stdin:
        return False, "Script must read from stdin (e.g., sys.stdin.read())"

    if not has_json_parse:
        return False, "Script must parse JSON input (e.g., json.loads())"

    if not has_json_output:
        return False, "Script must output JSON (e.g., print(json.dumps(...)))"

    return True, ""


def ensure_directories():
    """Ensure required directories exist."""
    os.makedirs("execution", exist_ok=True)
    os.makedirs(os.path.join(".staging", "tools"), exist_ok=True)
    os.makedirs(os.path.join(".backups", "tools"), exist_ok=True)


def tool_exists(name: str) -> bool:
    """Check if tool exists in execution folder."""
    tool_path = os.path.join("execution", f"{name}.py")
    return os.path.exists(tool_path)


def create_backup(tool_path: str, name: str) -> str:
    """Create a backup of the existing tool. Returns backup path."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"{name}_{timestamp}.py"
    backup_path = os.path.join(".backups", "tools", backup_filename)

    shutil.copy2(tool_path, backup_path)

    # Clean up old backups (keep last 3)
    cleanup_old_backups(name)

    return backup_path


def cleanup_old_backups(name: str, keep_count: int = 3):
    """Keep only the most recent backups for a tool."""
    backup_dir = os.path.join(".backups", "tools")
    if not os.path.exists(backup_dir):
        return

    # Find all backups for this tool
    pattern = re.compile(rf'^{re.escape(name)}_\d{{8}}_\d{{6}}\.py$')
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


def run_test(script_path: str, test_input: dict, timeout: int = 30) -> dict:
    """Run a test of the tool with given input."""
    try:
        process = subprocess.Popen(
            ['python', script_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate(
            input=json.dumps(test_input),
            timeout=timeout
        )

        # Try to parse output as JSON
        try:
            output_json = json.loads(stdout)
            return {
                "success": process.returncode == 0,
                "output": output_json,
                "stderr": stderr if stderr else None,
                "exit_code": process.returncode
            }
        except json.JSONDecodeError:
            return {
                "success": False,
                "output": stdout,
                "stderr": stderr if stderr else None,
                "exit_code": process.returncode,
                "error": "Output was not valid JSON"
            }

    except subprocess.TimeoutExpired:
        process.kill()
        return {
            "success": False,
            "error": f"Test execution timed out after {timeout} seconds"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Test execution failed: {str(e)}"
        }


def update_manifest(name: str, description: str = None, input_schema: dict = None) -> bool:
    """Update tool entry in tool_manifest.json if description or schema changed."""
    manifest_path = os.path.join("execution", "tool_manifest.json")

    if not os.path.exists(manifest_path):
        return False

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if "tools" not in manifest:
        return False

    # Find and update the tool entry
    updated = False
    for tool in manifest["tools"]:
        if tool.get("name") == name:
            if description is not None:
                tool["description"] = description
                updated = True
            if input_schema is not None:
                tool["input_schema"] = input_schema
                updated = True
            break

    if updated:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

    return updated


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
            "manifest_updated": False,
            "test_result": None,
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Extract fields
    name = input_data.get("name", "").strip()
    description = input_data.get("description")  # Optional
    script_content = input_data.get("script_content", "")
    input_schema = input_data.get("input_schema")  # Optional
    test_input = input_data.get("test_input")  # Optional

    # Validate required fields
    if not name:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
            "error": "Missing required field: name"
        }))
        sys.exit(1)

    if not script_content:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
            "error": "Missing required field: script_content"
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
            "manifest_updated": False,
            "test_result": None,
            "error": error_msg
        }))
        sys.exit(1)

    # Check if tool exists
    tool_path = os.path.join("execution", f"{name}.py")
    if not tool_exists(name):
        print(json.dumps({
            "success": False,
            "message": None,
            "path": tool_path,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
            "error": f"Tool '{name}' does not exist. Use create_tool to create it."
        }))
        sys.exit(1)

    # Validate Python syntax
    valid, error_msg = validate_python_syntax(script_content)
    if not valid:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
            "error": error_msg
        }))
        sys.exit(1)

    # Check JSON contract patterns
    valid, error_msg = check_json_contract(script_content)
    if not valid:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
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
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
            "error": f"Failed to create directories: {str(e)}"
        }))
        sys.exit(1)

    # Write to staging first
    staging_path = os.path.join(".staging", "tools", f"{name}.py")
    try:
        with open(staging_path, "w", encoding="utf-8") as f:
            f.write(script_content)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": None,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": None,
            "error": f"Failed to write to staging: {str(e)}"
        }))
        sys.exit(1)

    # Run test if test_input provided
    test_result = None
    if test_input is not None:
        test_result = run_test(staging_path, test_input)
        if not test_result.get("success", False):
            # Clean up staging file on test failure
            try:
                os.remove(staging_path)
            except Exception:
                pass
            print(json.dumps({
                "success": False,
                "message": None,
                "path": None,
                "backup_path": None,
                "manifest_updated": False,
                "test_result": test_result,
                "error": f"Test execution failed: {test_result.get('error', 'Unknown error')}"
            }))
            sys.exit(1)

    # Create backup of existing tool
    backup_path = None
    try:
        backup_path = create_backup(tool_path, name)
    except Exception as e:
        # Clean up staging file on backup failure
        try:
            os.remove(staging_path)
        except Exception:
            pass
        print(json.dumps({
            "success": False,
            "message": None,
            "path": tool_path,
            "backup_path": None,
            "manifest_updated": False,
            "test_result": test_result,
            "error": f"Failed to create backup: {str(e)}"
        }))
        sys.exit(1)

    # Move from staging to execution (overwrites existing)
    try:
        shutil.move(staging_path, tool_path)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": None,
            "path": tool_path,
            "backup_path": backup_path,
            "manifest_updated": False,
            "test_result": test_result,
            "error": f"Failed to deploy tool update: {str(e)}"
        }))
        sys.exit(1)

    # Update manifest only if description or input_schema provided
    manifest_updated = False
    if description is not None or input_schema is not None:
        try:
            manifest_updated = update_manifest(name, description, input_schema)
        except Exception as e:
            # Tool was updated but manifest update failed - warn but don't fail
            print(json.dumps({
                "success": True,
                "message": f"Tool '{name}' updated but manifest update failed: {str(e)}",
                "path": tool_path,
                "backup_path": backup_path,
                "manifest_updated": False,
                "test_result": test_result,
                "error": None
            }))
            sys.exit(0)

    # Success
    print(json.dumps({
        "success": True,
        "message": f"Tool '{name}' updated successfully",
        "path": tool_path,
        "backup_path": backup_path,
        "manifest_updated": manifest_updated,
        "test_result": test_result,
        "error": None
    }))


if __name__ == "__main__":
    main()
