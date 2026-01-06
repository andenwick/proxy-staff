#!/usr/bin/env python3
"""
recall.py - Search the tenant's life/ folder for content.

This tool now uses life_read.py for structured data access while
maintaining backwards compatibility with text search.

Input JSON:
{
    "query": "search term",
    "category": "all|knowledge|events|relationships|identity|patterns|boundaries",

    // NEW: Structured data options
    "file": "contacts|business|patterns|...",  // Specific file to read
    "path": "contacts[0].name",  // Dot notation path to specific field
    "structured": true  // Return structured data instead of text search
}

Output JSON:
{
    "status": "success",
    "results": [...],
    "total_matches": 5,

    // When structured=true or file+path specified:
    "data": { ... structured JSON ... },
    "markdown": "..."
}
"""

import sys
import json
import subprocess
from pathlib import Path


def call_life_read(file_name: str, query: str | None = None, path: str | None = None) -> dict:
    """Call life_read.py with the given parameters."""
    script_path = Path(__file__).parent / "life_read.py"

    input_data = {"file": file_name}
    if query:
        input_data["query"] = query
    if path:
        input_data["path"] = path

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
            try:
                return json.loads(result.stdout)
            except:
                return {"status": "error", "message": result.stderr or "Unknown error"}

    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "life_read.py timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def search_file(file_path: Path, query: str) -> list[str]:
    """Search a file for lines containing the query (fallback)."""
    matches = []
    query_lower = query.lower()

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                if query_lower in line.lower():
                    matches.append(line.strip())
    except Exception:
        pass

    return matches


def get_all_life_files() -> list[str]:
    """Get list of all life file names."""
    return [
        "identity", "boundaries", "patterns", "questions",
        "contacts", "business", "procedures", "people"
    ]


def get_search_paths(category: str) -> list[Path]:
    """Get paths to search based on category."""
    life_dir = Path("life")

    if not life_dir.exists():
        return []

    if category == "all":
        return list(life_dir.rglob("*.md"))

    category_map = {
        "knowledge": life_dir / "knowledge",
        "events": life_dir / "events",
        "relationships": life_dir / "relationships",
    }

    if category in category_map:
        search_dir = category_map[category]
        if search_dir.exists():
            return list(search_dir.rglob("*.md"))

    root_files = {
        "patterns": life_dir / "patterns.md",
        "questions": life_dir / "questions.md",
        "identity": life_dir / "identity.md",
        "boundaries": life_dir / "boundaries.md",
    }

    if category in root_files and root_files[category].exists():
        return [root_files[category]]

    return []


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        query = input_data.get("query")
        category = input_data.get("category", "all")
        file_name = input_data.get("file")
        path = input_data.get("path")
        structured = input_data.get("structured", False)

        # Mode 1: Direct file read with optional path
        if file_name:
            result = call_life_read(file_name, query, path)
            print(json.dumps(result))
            return

        # Mode 2: Structured search across files
        if structured and query:
            all_results = []
            for file in get_all_life_files():
                result = call_life_read(file, query)
                if result.get("status") == "success":
                    search_info = result.get("search", {})
                    if search_info.get("total", 0) > 0:
                        all_results.append({
                            "file": result.get("file_path"),
                            "data": result.get("data"),
                            "matches": search_info.get("matches", [])
                        })

            total_matches = sum(len(r.get("matches", [])) for r in all_results)
            print(json.dumps({
                "status": "success",
                "results": all_results,
                "total_matches": total_matches,
                "structured": True
            }))
            return

        # Mode 3: Text search (backwards compatible)
        if not query:
            raise ValueError("Missing required field: query (or file)")

        search_paths = get_search_paths(category)
        results = []
        total_matches = 0

        for file_path in search_paths:
            matches = search_file(file_path, query)
            if matches:
                results.append({
                    "file": str(file_path),
                    "matches": matches[:10]
                })
                total_matches += len(matches)

        result = {
            "status": "success",
            "results": results,
            "total_matches": total_matches
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
