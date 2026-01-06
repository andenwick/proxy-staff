#!/usr/bin/env python3
"""
remember.py - Save content to the tenant's life/ folder.

This tool now uses the structured life_write.py for updates when possible,
falling back to markdown append for unstructured content.

Input JSON:
{
    "category": "knowledge|pattern|relationship|identity|boundary",
    "file": "contacts.md",  // Optional: specific file in the category
    "content": "Content to save",

    // NEW: Structured data options (optional)
    "structured": {
        "field": "contacts",  // Array field to append to
        "data": { "name": "John", "role": "Client" }  // Structured data
    }
}

Output JSON:
{
    "status": "success",
    "file": "life/knowledge/contacts.md",
    "message": "Content saved successfully"
}
"""

import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path


def get_life_file_name(category: str, file: str | None) -> str:
    """Map category to life file name."""
    category_map = {
        "knowledge": file.replace(".md", "") if file else "business",
        "pattern": "patterns",
        "relationship": "people",
        "identity": "identity",
        "boundary": "boundaries",
        "boundaries": "boundaries",
    }

    if category in category_map:
        return category_map[category]

    # If file is specified, extract base name
    if file:
        return file.replace(".md", "")

    return "business"


def call_life_write(file_name: str, operation: str, path: str | None, value, markdown: str | None = None) -> dict:
    """Call life_write.py with the given parameters."""
    script_path = Path(__file__).parent / "life_write.py"

    input_data = {
        "file": file_name,
        "operation": operation,
    }

    if path:
        input_data["path"] = path
    if value is not None:
        input_data["value"] = value
    if markdown:
        input_data["markdown"] = markdown

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            # Parse error from stderr or stdout
            try:
                return json.loads(result.stdout)
            except:
                return {"status": "error", "message": result.stderr or "Unknown error"}

    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "life_write.py timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_array_path(category: str) -> str | None:
    """Get the array path for appending structured data."""
    array_paths = {
        "pattern": "work",  # Default to work patterns
        "relationship": "people",
        "knowledge": "facts",
    }
    return array_paths.get(category)


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        category = input_data.get("category")
        file = input_data.get("file")
        content = input_data.get("content")
        structured = input_data.get("structured")

        if not category:
            raise ValueError("Missing required field: category")

        # Determine the life file to update
        file_name = get_life_file_name(category, file)

        # Handle structured data (new approach)
        if structured:
            field = structured.get("field")
            data = structured.get("data", {})

            if not field:
                raise ValueError("structured.field is required when using structured data")

            # Add timestamp if not present
            if isinstance(data, dict) and "learnedAt" not in data and "observedAt" not in data:
                data["learnedAt"] = datetime.utcnow().isoformat() + "Z"

            # Append to the specified array field
            result = call_life_write(file_name, "append", field, data)

            if result.get("status") == "success":
                print(json.dumps({
                    "status": "success",
                    "file": result.get("file_path", f"life/{file_name}.md"),
                    "message": f"Structured data saved to {field}",
                    "structured": True
                }))
            else:
                print(json.dumps(result))
                sys.exit(1)
            return

        # Handle unstructured content (backwards compatible)
        if not content:
            raise ValueError("Missing required field: content (or structured)")

        # For unstructured content, append to markdown with timestamp
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        markdown_content = f"## {timestamp}\n{content}"

        # Use life_write to append markdown
        result = call_life_write(file_name, "merge", None, {}, markdown_content)

        if result.get("status") == "success":
            print(json.dumps({
                "status": "success",
                "file": result.get("file_path", f"life/{file_name}.md"),
                "message": "Content saved successfully"
            }))
        else:
            # Fallback to direct file write if life_write fails
            life_dir = Path("life")
            file_map = {
                "patterns": life_dir / "patterns.md",
                "identity": life_dir / "identity.md",
                "boundaries": life_dir / "boundaries.md",
                "business": life_dir / "knowledge" / "business.md",
                "contacts": life_dir / "knowledge" / "contacts.md",
                "procedures": life_dir / "knowledge" / "procedures.md",
                "people": life_dir / "relationships" / "people.md",
            }

            file_path = file_map.get(file_name, life_dir / f"{file_name}.md")
            file_path.parent.mkdir(parents=True, exist_ok=True)

            formatted_content = f"\n\n## {timestamp}\n{content}"
            with open(file_path, "a", encoding="utf-8") as f:
                f.write(formatted_content)

            print(json.dumps({
                "status": "success",
                "file": str(file_path),
                "message": "Content saved successfully (fallback)"
            }))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
