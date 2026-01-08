#!/usr/bin/env python3
"""
prospect_write.py - Create or update prospect files in relationships/prospects/

Input JSON:
{
    "operation": "create|update",
    "slug": "john-smith",           # required for update, auto-generated for create
    "data": {
        "name": "John Smith",       # required for create
        "email": "john@example.com", # required for create
        "company": "ABC Corp",
        "title": "CEO",
        "phone": "555-1234",
        "website": "abc.com",
        "linkedin": "linkedin.com/in/johnsmith",
        "source": "google_maps",
        "source_query": "CEOs in Salt Lake City",
        "stage": "identified",
        "business_context": "...",
        "research_notes": "...",
        "personalization_hooks": "...",
        "interaction_history_append": "### 2026-01-07 - Note\n..."
    }
}

Output JSON:
{
    "status": "success",
    "message": "...",
    "slug": "john-smith",
    "prospect": { ... }
}
"""

import sys
import json
import re
from pathlib import Path
from datetime import datetime


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


def build_markdown_body(
    business_context: str = "",
    research_notes: str = "",
    personalization_hooks: str = "",
    interaction_history: str = ""
) -> str:
    """Build markdown body from sections."""
    sections = []

    sections.append("## Business Context")
    sections.append(business_context)
    sections.append("")

    sections.append("## Research Notes")
    sections.append(research_notes)
    sections.append("")

    sections.append("## Personalization Hooks")
    sections.append(personalization_hooks)
    sections.append("")

    sections.append("## Interaction History")
    sections.append(interaction_history)

    return "\n".join(sections)


def generate_slug(name: str) -> str:
    """Generate a slug from a name (kebab-case)."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)  # Remove special chars
    slug = re.sub(r'\s+', '-', slug)  # Replace spaces with hyphens
    slug = re.sub(r'-+', '-', slug)  # Collapse multiple hyphens
    slug = slug.strip('-')  # Trim leading/trailing hyphens
    return slug


def ensure_unique_slug(prospects_folder: Path, base_slug: str) -> str:
    """Ensure slug is unique by appending a number if necessary."""
    if not prospects_folder.exists():
        return base_slug

    slug = base_slug
    counter = 1

    while (prospects_folder / f"{slug}.md").exists():
        slug = f"{base_slug}-{counter}"
        counter += 1

    return slug


def get_prospects_folder() -> Path:
    """Get the path to prospects folder."""
    return Path("relationships") / "prospects"


def create_prospect(data: dict) -> tuple[str, dict]:
    """Create a new prospect file."""
    prospects_folder = get_prospects_folder()

    # Validate required fields
    name = data.get("name", "").strip()
    email = data.get("email", "").strip()

    if not name:
        raise ValueError("Prospect name is required")
    if not email:
        raise ValueError("Prospect email is required")

    # Ensure directory exists
    prospects_folder.mkdir(parents=True, exist_ok=True)

    # Generate unique slug
    base_slug = generate_slug(name)
    slug = ensure_unique_slug(prospects_folder, base_slug)

    now = datetime.utcnow().isoformat() + "Z"

    frontmatter = {
        "name": name,
        "email": email,
        "company": data.get("company"),
        "title": data.get("title"),
        "phone": data.get("phone"),
        "website": data.get("website"),
        "linkedin": data.get("linkedin"),
        "source": data.get("source"),
        "source_query": data.get("source_query"),
        "stage": data.get("stage", "identified"),
        "created_at": now,
        "updated_at": now
    }

    # Remove None values
    frontmatter = {k: v for k, v in frontmatter.items() if v is not None}

    markdown = build_markdown_body(
        data.get("business_context", ""),
        data.get("research_notes", ""),
        data.get("personalization_hooks", ""),
        ""
    )

    content = serialize_frontmatter(frontmatter, markdown)
    file_path = prospects_folder / f"{slug}.md"
    file_path.write_text(content, encoding="utf-8")

    return slug, {
        "slug": slug,
        "frontmatter": frontmatter,
        "business_context": data.get("business_context", ""),
        "research_notes": data.get("research_notes", ""),
        "personalization_hooks": data.get("personalization_hooks", ""),
        "interaction_history": ""
    }


def update_prospect(slug: str, updates: dict) -> dict:
    """Update an existing prospect file."""
    prospects_folder = get_prospects_folder()
    file_path = prospects_folder / f"{slug}.md"

    if not file_path.exists():
        raise ValueError(f"Prospect '{slug}' not found")

    content = file_path.read_text(encoding="utf-8")
    frontmatter, markdown = parse_frontmatter(content)
    sections = parse_body_sections(markdown)

    now = datetime.utcnow().isoformat() + "Z"
    frontmatter["updated_at"] = now

    # Update frontmatter fields
    frontmatter_fields = ["name", "email", "company", "title", "phone", "website", "linkedin", "source", "source_query", "stage"]
    for field in frontmatter_fields:
        if field in updates:
            frontmatter[field] = updates[field]

    # Update body sections
    if "business_context" in updates:
        sections["business_context"] = updates["business_context"]
    if "research_notes" in updates:
        sections["research_notes"] = updates["research_notes"]
    if "personalization_hooks" in updates:
        sections["personalization_hooks"] = updates["personalization_hooks"]

    # Append to interaction history
    if "interaction_history_append" in updates:
        if sections["interaction_history"]:
            sections["interaction_history"] += "\n\n" + updates["interaction_history_append"]
        else:
            sections["interaction_history"] = updates["interaction_history_append"]

    markdown = build_markdown_body(
        sections["business_context"],
        sections["research_notes"],
        sections["personalization_hooks"],
        sections["interaction_history"]
    )

    content = serialize_frontmatter(frontmatter, markdown)
    file_path.write_text(content, encoding="utf-8")

    return {
        "slug": slug,
        "frontmatter": frontmatter,
        **sections
    }


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        operation = input_data.get("operation")
        slug = input_data.get("slug")
        data = input_data.get("data", {})

        if not operation:
            raise ValueError("Missing required field: operation")

        if operation == "create":
            created_slug, prospect = create_prospect(data)
            result = {
                "status": "success",
                "message": f"Prospect '{prospect['frontmatter']['name']}' created",
                "slug": created_slug,
                "prospect": prospect
            }

        elif operation == "update":
            if not slug:
                raise ValueError("Missing slug for update operation")

            prospect = update_prospect(slug, data)
            result = {
                "status": "success",
                "message": f"Prospect '{slug}' updated",
                "slug": slug,
                "prospect": prospect
            }

        else:
            raise ValueError(f"Unknown operation: {operation}")

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
