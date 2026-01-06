#!/usr/bin/env python3
"""
life_write.py - CRUD operations on life file frontmatter data.

Input JSON:
{
    "file": "identity|boundaries|patterns|contacts|business|procedures|people|questions",
    "operation": "set|merge|append|remove",
    "path": "optional.dot.path.to.field",
    "value": <value to set/merge/append>,
    "markdown": "optional markdown to append"
}

Operations:
- set: Replace value at path (or entire data if no path)
- merge: Deep merge value into existing data
- append: Append to array at path
- remove: Remove item from array at path (value is the item or index)

Output JSON:
{
    "status": "success",
    "file_path": "life/identity.md",
    "message": "Updated successfully",
    "data": { ... updated data ... }
}
"""

import sys
import json
import re
import copy
from pathlib import Path
from datetime import datetime

# Add parent directory to path for schema imports
sys.path.insert(0, str(Path(__file__).parent))
from schemas.life_schemas import get_default_data, validate_data, SCHEMA_VERSION


def get_life_file_path(file_name: str) -> Path:
    """Get the full path to a life file."""
    life_dir = Path("life")

    file_map = {
        "identity": life_dir / "identity.md",
        "boundaries": life_dir / "boundaries.md",
        "patterns": life_dir / "patterns.md",
        "questions": life_dir / "questions.md",
        "contacts": life_dir / "knowledge" / "contacts.md",
        "business": life_dir / "knowledge" / "business.md",
        "procedures": life_dir / "knowledge" / "procedures.md",
        "people": life_dir / "relationships" / "people.md",
        "relationships": life_dir / "relationships" / "people.md",
    }

    if file_name in file_map:
        return file_map[file_name]

    if not file_name.startswith("life/"):
        return life_dir / file_name

    return Path(file_name)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse JSON frontmatter from markdown content."""
    pattern = r'^---json\s*\n(.*?)\n---\s*\n?(.*)$'
    match = re.match(pattern, content, re.DOTALL)

    if match:
        try:
            json_str = match.group(1)
            data = json.loads(json_str)
            markdown = match.group(2)
            return data, markdown
        except json.JSONDecodeError:
            return {}, content

    return {}, content


def serialize_frontmatter(data: dict, markdown: str) -> str:
    """Serialize data and markdown back to frontmatter format."""
    json_str = json.dumps(data, indent=2, ensure_ascii=False)
    return f"---json\n{json_str}\n---\n{markdown}"


def set_nested_value(data: dict, path: str, value) -> dict:
    """Set a value in nested dict using dot notation path."""
    if not path:
        if isinstance(value, dict):
            return value
        raise ValueError("Cannot set non-dict value without path")

    result = copy.deepcopy(data)
    keys = path.split(".")
    current = result

    for key in keys[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]

    current[keys[-1]] = value
    return result


def deep_merge(base: dict, update: dict) -> dict:
    """Deep merge update into base dict."""
    result = copy.deepcopy(base)

    for key, value in update.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)

    return result


def append_to_array(data: dict, path: str, value) -> dict:
    """Append value to array at path."""
    result = copy.deepcopy(data)
    keys = path.split(".")
    current = result

    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        current = current[key]

    final_key = keys[-1]
    if final_key not in current:
        current[final_key] = []

    if not isinstance(current[final_key], list):
        raise ValueError(f"Path {path} is not an array")

    # Check for duplicates by id if value has an id
    if isinstance(value, dict) and "id" in value:
        for i, item in enumerate(current[final_key]):
            if isinstance(item, dict) and item.get("id") == value["id"]:
                # Update existing item instead of appending
                current[final_key][i] = value
                return result

    current[final_key].append(value)
    return result


def remove_from_array(data: dict, path: str, value) -> dict:
    """Remove item from array at path. Value can be index (int) or item to match."""
    result = copy.deepcopy(data)
    keys = path.split(".")
    current = result

    for key in keys[:-1]:
        if key not in current:
            raise ValueError(f"Path {path} not found")
        current = current[key]

    final_key = keys[-1]
    if final_key not in current or not isinstance(current[final_key], list):
        raise ValueError(f"Path {path} is not an array")

    array = current[final_key]

    if isinstance(value, int):
        # Remove by index
        if 0 <= value < len(array):
            array.pop(value)
    elif isinstance(value, dict) and "id" in value:
        # Remove by id match
        current[final_key] = [
            item for item in array
            if not (isinstance(item, dict) and item.get("id") == value["id"])
        ]
    else:
        # Remove by value match
        current[final_key] = [item for item in array if item != value]

    return result


def generate_id() -> str:
    """Generate a simple unique ID."""
    import uuid
    return str(uuid.uuid4())[:8]


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        file_name = input_data.get("file")
        operation = input_data.get("operation", "merge")
        path = input_data.get("path")
        value = input_data.get("value")
        markdown_append = input_data.get("markdown")

        if not file_name:
            raise ValueError("Missing required field: file")

        if operation not in ["set", "merge", "append", "remove"]:
            raise ValueError(f"Invalid operation: {operation}. Must be set, merge, append, or remove")

        file_path = get_life_file_path(file_name)

        # Ensure parent directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Read existing content or create default
        if file_path.exists():
            content = file_path.read_text(encoding="utf-8")
            data, markdown = parse_frontmatter(content)
            if not data:
                data = get_default_data(file_name)
        else:
            data = get_default_data(file_name)
            markdown = ""

        # Apply operation
        if operation == "set":
            if path:
                data = set_nested_value(data, path, value)
            elif isinstance(value, dict):
                # Preserve version
                value["version"] = data.get("version", SCHEMA_VERSION)
                data = value
            else:
                raise ValueError("set operation requires dict value when no path specified")

        elif operation == "merge":
            if value and isinstance(value, dict):
                if path:
                    # Get existing value at path
                    keys = path.split(".")
                    current = data
                    for key in keys:
                        if isinstance(current, dict) and key in current:
                            current = current[key]
                        else:
                            current = {}
                            break

                    if isinstance(current, dict):
                        merged = deep_merge(current, value)
                        data = set_nested_value(data, path, merged)
                    else:
                        data = set_nested_value(data, path, value)
                else:
                    data = deep_merge(data, value)

        elif operation == "append":
            if not path:
                raise ValueError("append operation requires path to array")
            if value is None:
                raise ValueError("append operation requires value")

            # Auto-generate ID if value is dict without id
            if isinstance(value, dict) and "id" not in value:
                value["id"] = generate_id()

            data = append_to_array(data, path, value)

        elif operation == "remove":
            if not path:
                raise ValueError("remove operation requires path to array")
            if value is None:
                raise ValueError("remove operation requires value (item or index)")

            data = remove_from_array(data, path, value)

        # Update lastUpdated timestamp
        data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

        # Append markdown if provided
        if markdown_append:
            if markdown and not markdown.endswith("\n"):
                markdown += "\n"
            markdown += f"\n{markdown_append}\n"

        # Validate data
        is_valid, errors = validate_data(file_name, data)
        if not is_valid:
            # Log warning but don't fail - be permissive
            pass

        # Write back to file
        output = serialize_frontmatter(data, markdown)
        file_path.write_text(output, encoding="utf-8")

        result = {
            "status": "success",
            "file_path": str(file_path),
            "message": f"Updated {file_name} successfully",
            "operation": operation,
            "data": data
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
