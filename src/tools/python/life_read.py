#!/usr/bin/env python3
"""
life_read.py - Read structured life data from frontmatter + markdown files.

Input JSON:
{
    "file": "identity|boundaries|patterns|contacts|business|procedures|people|questions",
    "query": "optional search term",
    "path": "optional.dot.path.to.field"
}

Output JSON:
{
    "status": "success",
    "data": { ... structured JSON data ... },
    "markdown": "... markdown content below frontmatter ...",
    "file_path": "life/identity.md"
}

Frontmatter format:
---json
{ "version": 1, "name": "..." }
---
# Markdown content here
"""

import sys
import json
import re
from pathlib import Path
from datetime import datetime

# Add parent directory to path for schema imports
sys.path.insert(0, str(Path(__file__).parent))
from schemas.life_schemas import get_default_data, get_schema


def get_life_file_path(file_name: str) -> Path:
    """Get the full path to a life file."""
    life_dir = Path("life")

    # Map short names to full paths
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

    # If it's a known short name, use the mapping
    if file_name in file_map:
        return file_map[file_name]

    # Otherwise, treat as relative path within life/
    if not file_name.startswith("life/"):
        return life_dir / file_name

    return Path(file_name)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    Parse JSON frontmatter from markdown content.

    Returns (data_dict, markdown_content).
    If no frontmatter, returns (empty_dict, original_content).
    """
    # Pattern for JSON frontmatter: ---json\n{...}\n---
    pattern = r'^---json\s*\n(.*?)\n---\s*\n?(.*)$'
    match = re.match(pattern, content, re.DOTALL)

    if match:
        try:
            json_str = match.group(1)
            data = json.loads(json_str)
            markdown = match.group(2)
            return data, markdown
        except json.JSONDecodeError:
            # Invalid JSON, return as markdown only
            return {}, content

    # No frontmatter found
    return {}, content


def get_nested_value(data: dict, path: str):
    """Get a value from nested dict using dot notation path."""
    if not path:
        return data

    keys = path.split(".")
    current = data

    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list):
            try:
                index = int(key)
                current = current[index]
            except (ValueError, IndexError):
                return None
        else:
            return None

    return current


def search_content(data: dict, markdown: str, query: str) -> list[dict]:
    """
    Search for query in both structured data and markdown.
    Returns list of matches with context.
    """
    results = []
    query_lower = query.lower()

    # Search in structured data
    def search_dict(obj, path=""):
        if isinstance(obj, dict):
            for key, value in obj.items():
                new_path = f"{path}.{key}" if path else key
                search_dict(value, new_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                new_path = f"{path}[{i}]"
                search_dict(item, new_path)
        elif isinstance(obj, str) and query_lower in obj.lower():
            results.append({
                "type": "data",
                "path": path,
                "value": obj,
                "match": query
            })

    search_dict(data)

    # Search in markdown
    lines = markdown.split("\n")
    for i, line in enumerate(lines):
        if query_lower in line.lower():
            results.append({
                "type": "markdown",
                "line": i + 1,
                "content": line.strip(),
                "match": query
            })

    return results


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        file_name = input_data.get("file")
        query = input_data.get("query")
        path = input_data.get("path")

        if not file_name:
            raise ValueError("Missing required field: file")

        file_path = get_life_file_path(file_name)

        # Check if file exists
        if not file_path.exists():
            # Return default empty data for this file type
            default_data = get_default_data(file_name)
            result = {
                "status": "success",
                "data": default_data,
                "markdown": "",
                "file_path": str(file_path),
                "exists": False
            }
            print(json.dumps(result))
            return

        # Read and parse file
        content = file_path.read_text(encoding="utf-8")
        data, markdown = parse_frontmatter(content)

        # If no structured data found, use defaults
        if not data:
            data = get_default_data(file_name)

        # Handle path query (get specific field)
        if path:
            value = get_nested_value(data, path)
            result = {
                "status": "success",
                "data": value,
                "path": path,
                "file_path": str(file_path),
                "exists": True
            }
            print(json.dumps(result))
            return

        # Handle search query
        if query:
            matches = search_content(data, markdown, query)
            result = {
                "status": "success",
                "data": data,
                "markdown": markdown,
                "file_path": str(file_path),
                "exists": True,
                "search": {
                    "query": query,
                    "matches": matches,
                    "total": len(matches)
                }
            }
            print(json.dumps(result))
            return

        # Default: return full content
        result = {
            "status": "success",
            "data": data,
            "markdown": markdown,
            "file_path": str(file_path),
            "exists": True
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
