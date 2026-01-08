#!/usr/bin/env python3
"""
migrate_targets_to_prospects.py - Migrate inline target data to prospect files

This script converts campaign targets that use the old inline data format
to the new prospect-reference format.

Input JSON:
{
    "campaign": "campaign-name",    # required
    "dry_run": true                 # optional - if true, don't write files
}

The script will:
1. Read all targets from the campaign's targets.md file
2. For each target with inline data:
   - Create a prospect file if one doesn't exist for that email
   - Replace the inline target with a reference to the prospect slug
3. Update the targets.md file to use the new reference format

Output JSON:
{
    "status": "success",
    "message": "...",
    "migrated": 5,
    "skipped": 2,
    "errors": ["error1", "error2"],
    "details": [
        {"name": "John Smith", "email": "john@example.com", "action": "created_prospect", "slug": "john-smith"},
        {"name": "Jane Doe", "email": "jane@example.com", "action": "found_existing", "slug": "jane-doe"},
        ...
    ]
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


def get_campaign_path(campaign_name: str) -> Path:
    """Get the path to a campaign folder."""
    safe_name = re.sub(r'[^a-z0-9-]', '-', campaign_name.lower())
    return Path("operations") / "campaigns" / safe_name


def get_prospects_folder() -> Path:
    """Get the path to prospects folder."""
    return Path("relationships") / "prospects"


def generate_slug(name: str) -> str:
    """Generate a slug from a name (kebab-case)."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)  # Remove special chars
    slug = re.sub(r'\s+', '-', slug)  # Replace spaces with hyphens
    slug = re.sub(r'-+', '-', slug)  # Collapse multiple hyphens
    slug = slug.strip('-')  # Trim leading/trailing hyphens
    return slug or "unknown"


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


def find_prospect_by_email(prospects_folder: Path, email: str) -> str | None:
    """Find an existing prospect by email address."""
    if not prospects_folder.exists():
        return None

    email_lower = email.lower()

    for file_path in prospects_folder.glob("*.md"):
        try:
            content = file_path.read_text(encoding="utf-8")
            frontmatter, _ = parse_frontmatter(content)
            prospect_email = frontmatter.get("email", "").lower()
            if prospect_email == email_lower:
                return file_path.stem
        except Exception:
            continue

    return None


def create_prospect_file(
    prospects_folder: Path,
    name: str,
    email: str,
    company: str = None,
    title: str = None,
    phone: str = None,
    linkedin: str = None,
    research: dict = None,
    stage: str = "identified"
) -> str:
    """Create a new prospect file and return the slug."""
    prospects_folder.mkdir(parents=True, exist_ok=True)

    base_slug = generate_slug(name)
    slug = ensure_unique_slug(prospects_folder, base_slug)

    now = datetime.utcnow().isoformat() + "Z"

    frontmatter = {
        "name": name,
        "email": email,
        "company": company,
        "title": title,
        "phone": phone,
        "linkedin": linkedin,
        "source": "campaign_migration",
        "stage": stage,
        "created_at": now,
        "updated_at": now
    }

    # Remove None values
    frontmatter = {k: v for k, v in frontmatter.items() if v is not None}

    # Build markdown body
    markdown_parts = []
    markdown_parts.append("## Business Context")

    if research and research.get("summary"):
        markdown_parts.append(research["summary"])
    markdown_parts.append("")

    markdown_parts.append("## Research Notes")
    if research and research.get("news"):
        for item in research["news"]:
            markdown_parts.append(f"- {item}")
    markdown_parts.append("")

    markdown_parts.append("## Personalization Hooks")
    markdown_parts.append("")

    markdown_parts.append("## Interaction History")
    markdown_parts.append(f"### {now[:10]} - Migrated from campaign")
    markdown_parts.append("Prospect created from existing campaign target data.")

    markdown = "\n".join(markdown_parts)

    content = serialize_frontmatter(frontmatter, markdown)
    file_path = prospects_folder / f"{slug}.md"
    file_path.write_text(content, encoding="utf-8")

    return slug


def migrate_campaign(campaign_name: str, dry_run: bool = False) -> dict:
    """Migrate a campaign's inline targets to prospect references."""
    campaign_path = get_campaign_path(campaign_name)
    prospects_folder = get_prospects_folder()

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found at {campaign_path}")

    targets_path = campaign_path / "targets.md"
    if not targets_path.exists():
        raise ValueError(f"Targets file not found at {targets_path}")

    content = targets_path.read_text(encoding="utf-8")
    data, markdown = parse_frontmatter(content)

    # Check if already migrated
    if "target_references" in data and "targets" not in data:
        return {
            "migrated": 0,
            "skipped": 0,
            "errors": [],
            "details": [],
            "message": "Campaign already uses reference format"
        }

    targets = data.get("targets", [])
    if not targets:
        return {
            "migrated": 0,
            "skipped": 0,
            "errors": [],
            "details": [],
            "message": "No targets to migrate"
        }

    migrated = 0
    skipped = 0
    errors = []
    details = []
    new_references = []

    for target in targets:
        target_name = target.get("name", "Unknown")
        target_email = target.get("email")

        if not target_email:
            errors.append(f"Target '{target_name}' has no email - cannot migrate")
            skipped += 1
            continue

        try:
            # Check if prospect already exists
            existing_slug = find_prospect_by_email(prospects_folder, target_email)

            if existing_slug:
                slug = existing_slug
                action = "found_existing"
            else:
                if dry_run:
                    slug = generate_slug(target_name)
                    action = "would_create"
                else:
                    slug = create_prospect_file(
                        prospects_folder,
                        name=target_name,
                        email=target_email,
                        company=target.get("company"),
                        title=target.get("title"),
                        phone=target.get("phone"),
                        linkedin=target.get("linkedin"),
                        research=target.get("research"),
                        stage=target.get("stage", "identified")
                    )
                    action = "created_prospect"

            # Create target reference
            new_ref = {
                "id": target.get("id"),
                "prospect_slug": slug,
                "added_at": target.get("created_at", datetime.utcnow().isoformat() + "Z"),
                "last_touch_at": None,
                "touch_count": len(target.get("touches", [])),
                "campaign_stage": target.get("stage", "identified"),
                "unsubscribed": target.get("unsubscribed", False)
            }

            # Set last_touch_at if there are touches
            touches = target.get("touches", [])
            if touches:
                new_ref["last_touch_at"] = touches[-1].get("sent_at")

            new_references.append(new_ref)
            migrated += 1

            details.append({
                "name": target_name,
                "email": target_email,
                "action": action,
                "slug": slug
            })

        except Exception as e:
            errors.append(f"Failed to migrate '{target_name}': {str(e)}")
            skipped += 1

    # Update targets.md with new format
    if not dry_run and new_references:
        new_data = {
            "version": 2,
            "lastUpdated": datetime.utcnow().isoformat() + "Z",
            "target_references": new_references
        }

        new_content = serialize_frontmatter(new_data, markdown)
        targets_path.write_text(new_content, encoding="utf-8")

    return {
        "migrated": migrated,
        "skipped": skipped,
        "errors": errors,
        "details": details,
        "message": f"{'Would migrate' if dry_run else 'Migrated'} {migrated} targets, skipped {skipped}"
    }


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        campaign_name = input_data.get("campaign")
        dry_run = input_data.get("dry_run", False)

        if not campaign_name:
            raise ValueError("Missing required field: campaign")

        result = migrate_campaign(campaign_name, dry_run)

        output = {
            "status": "success",
            **result
        }

        print(json.dumps(output))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
