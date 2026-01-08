#!/usr/bin/env python3
"""
prospect_read.py - Read prospect data from relationships/prospects/

Input JSON:
{
    "slug": "john-smith",       # optional - specific prospect by slug
    "email": "john@example.com" # optional - find by email
}

If neither slug nor email provided, lists all prospects.

Output JSON:
{
    "status": "success",
    "prospect": { ... },        # if slug or email provided
    "prospects": [ ... ],       # if listing all
    "count": 5
}
"""

import sys
import json
import re
from pathlib import Path


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


def parse_body_sections(markdown: str) -> dict:
    """Parse markdown body into sections."""
    sections = {
        "business_context": "",
        "research_notes": "",
        "personalization_hooks": "",
        "interaction_history": ""
    }

    section_pattern = r'## (Business Context|Research Notes|Personalization Hooks|Interaction History)\s*\n([\s\S]*?)(?=\n## |$)'

    for match in re.finditer(section_pattern, markdown):
        section_name = match.group(1)
        section_content = match.group(2).strip()

        if section_name == "Business Context":
            sections["business_context"] = section_content
        elif section_name == "Research Notes":
            sections["research_notes"] = section_content
        elif section_name == "Personalization Hooks":
            sections["personalization_hooks"] = section_content
        elif section_name == "Interaction History":
            sections["interaction_history"] = section_content

    return sections


def get_prospects_folder() -> Path:
    """Get the path to prospects folder."""
    return Path("relationships") / "prospects"


def read_prospect(slug: str) -> dict | None:
    """Read a single prospect by slug."""
    prospects_folder = get_prospects_folder()
    file_path = prospects_folder / f"{slug}.md"

    if not file_path.exists():
        return None

    content = file_path.read_text(encoding="utf-8")
    frontmatter, markdown = parse_frontmatter(content)
    sections = parse_body_sections(markdown)

    return {
        "slug": slug,
        "frontmatter": frontmatter,
        **sections
    }


def find_prospect_by_email(email: str) -> dict | None:
    """Find a prospect by email address."""
    prospects_folder = get_prospects_folder()

    if not prospects_folder.exists():
        return None

    email_lower = email.lower()

    for file_path in prospects_folder.glob("*.md"):
        try:
            content = file_path.read_text(encoding="utf-8")
            frontmatter, _ = parse_frontmatter(content)
            prospect_email = frontmatter.get("email", "").lower()
            if prospect_email == email_lower:
                slug = file_path.stem
                return read_prospect(slug)
        except Exception:
            continue

    return None


def list_prospects() -> list[dict]:
    """List all prospects."""
    prospects_folder = get_prospects_folder()

    if not prospects_folder.exists():
        return []

    prospects = []
    for file_path in prospects_folder.glob("*.md"):
        try:
            slug = file_path.stem
            prospect = read_prospect(slug)
            if prospect:
                prospects.append(prospect)
        except Exception:
            continue

    return prospects


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        slug = input_data.get("slug")
        email = input_data.get("email")

        if slug:
            # Read specific prospect by slug
            prospect = read_prospect(slug)
            if prospect:
                result = {
                    "status": "success",
                    "prospect": prospect
                }
            else:
                result = {
                    "status": "error",
                    "message": f"Prospect '{slug}' not found"
                }
                print(json.dumps(result))
                sys.exit(1)

        elif email:
            # Find prospect by email
            prospect = find_prospect_by_email(email)
            if prospect:
                result = {
                    "status": "success",
                    "prospect": prospect
                }
            else:
                result = {
                    "status": "error",
                    "message": f"No prospect found with email '{email}'"
                }
                print(json.dumps(result))
                sys.exit(1)

        else:
            # List all prospects
            prospects = list_prospects()
            result = {
                "status": "success",
                "prospects": prospects,
                "count": len(prospects)
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
