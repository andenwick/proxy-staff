#!/usr/bin/env python3
"""
migrate_life.py - Migrate existing life files to JSON frontmatter format.

This script reads existing markdown-only life files, extracts structured
data where possible, and converts them to the new frontmatter format.

Usage:
  python migrate_life.py                    # Migrate current directory's life/
  python migrate_life.py --tenant <id>      # Migrate specific tenant
  python migrate_life.py --dry-run          # Preview changes without writing

Input JSON (when called as tool):
{
    "tenant_id": "optional tenant id",
    "dry_run": false
}

Output JSON:
{
    "status": "success",
    "migrated": ["life/identity.md", ...],
    "skipped": ["life/patterns.md", ...],
    "errors": []
}
"""

import sys
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

# Add parent directory to path for schema imports
sys.path.insert(0, str(Path(__file__).parent))
from schemas.life_schemas import get_default_data, SCHEMA_VERSION


def has_frontmatter(content: str) -> bool:
    """Check if content already has JSON frontmatter."""
    return content.strip().startswith("---json")


def extract_identity_data(content: str) -> dict:
    """Extract structured data from identity.md markdown."""
    data = get_default_data("identity")

    # Try to extract name
    name_match = re.search(r'[-*]\s*Name:\s*(.+)', content, re.IGNORECASE)
    if name_match:
        name = name_match.group(1).strip()
        if name and name != "[tenant name]":
            data["name"] = name

    # Try to extract timezone
    tz_match = re.search(r'[-*]\s*Timezone:\s*(.+)', content, re.IGNORECASE)
    if tz_match:
        tz = tz_match.group(1).strip()
        if tz and tz != "[timezone]":
            data["timezone"] = tz

    return data


def extract_boundaries_data(content: str) -> dict:
    """Extract structured data from boundaries.md markdown."""
    data = get_default_data("boundaries")

    # Extract "Never Do" items
    never_section = re.search(r'##\s*Never\s*Do\s*\n(.*?)(?=##|$)', content, re.DOTALL | re.IGNORECASE)
    if never_section:
        items = re.findall(r'[-*]\s+(.+)', never_section.group(1))
        data["neverDo"] = [item.strip() for item in items if item.strip()]

    # Extract "Always Do" items
    always_section = re.search(r'##\s*Always\s*Do\s*\n(.*?)(?=##|$)', content, re.DOTALL | re.IGNORECASE)
    if always_section:
        items = re.findall(r'[-*]\s+(.+)', always_section.group(1))
        data["alwaysDo"] = [item.strip() for item in items if item.strip()]

    # Extract "Escalate When" items
    escalate_section = re.search(r'##\s*Escalate\s*When\s*\n(.*?)(?=##|$)', content, re.DOTALL | re.IGNORECASE)
    if escalate_section:
        items = re.findall(r'[-*]\s+(.+)', escalate_section.group(1))
        data["escalateWhen"] = [item.strip() for item in items if item.strip()]

    # Extract response limits
    limit_match = re.search(r'Maximum\s+(\d+)\s+characters', content, re.IGNORECASE)
    if limit_match:
        data["limits"]["maxResponseChars"] = int(limit_match.group(1))

    return data


def extract_patterns_data(content: str) -> dict:
    """Extract structured data from patterns.md markdown."""
    data = get_default_data("patterns")

    # Try to extract last analyzed date
    date_match = re.search(r'Last\s*Analyzed[:\s]*(\d{4}-\d{2}-\d{2})', content, re.IGNORECASE)
    if date_match:
        data["lastAnalyzed"] = date_match.group(1) + "T00:00:00Z"

    return data


def extract_contacts_data(content: str) -> dict:
    """Extract structured data from contacts.md markdown."""
    data = get_default_data("contacts")

    # Look for patterns like "Name - Role" or "Name: Role"
    contact_patterns = re.findall(r'[-*]\s*\*\*(.+?)\*\*\s*[-:]\s*(.+)', content)
    for i, (name, role) in enumerate(contact_patterns):
        data["contacts"].append({
            "id": f"c{i+1}",
            "name": name.strip(),
            "role": role.strip()
        })

    return data


def serialize_frontmatter(data: dict, markdown: str) -> str:
    """Serialize data and markdown to frontmatter format."""
    json_str = json.dumps(data, indent=2, ensure_ascii=False)
    return f"---json\n{json_str}\n---\n{markdown}"


def migrate_file(file_path: Path, dry_run: bool = False) -> dict:
    """Migrate a single life file to frontmatter format."""
    result = {
        "file": str(file_path),
        "action": "skipped",
        "reason": ""
    }

    try:
        if not file_path.exists():
            result["reason"] = "File does not exist"
            return result

        content = file_path.read_text(encoding="utf-8")

        # Skip if already has frontmatter
        if has_frontmatter(content):
            result["reason"] = "Already has frontmatter"
            return result

        # Determine file type and extract data
        file_name = file_path.name.replace(".md", "")
        parent_name = file_path.parent.name

        # Map file to extraction function
        extractors = {
            "identity": extract_identity_data,
            "boundaries": extract_boundaries_data,
            "patterns": extract_patterns_data,
            "contacts": extract_contacts_data,
        }

        if file_name in extractors:
            data = extractors[file_name](content)
        else:
            # Use default data for other files
            data = get_default_data(file_name)

        # Update lastUpdated
        data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

        # Create new content with frontmatter
        new_content = serialize_frontmatter(data, content)

        if dry_run:
            result["action"] = "would_migrate"
            result["data"] = data
            return result

        # Backup original file
        backup_dir = file_path.parent / ".backups"
        backup_dir.mkdir(exist_ok=True)
        backup_path = backup_dir / f"{file_path.name}.{datetime.now().strftime('%Y%m%d_%H%M%S')}.bak"
        shutil.copy2(file_path, backup_path)

        # Write new content
        file_path.write_text(new_content, encoding="utf-8")

        result["action"] = "migrated"
        result["backup"] = str(backup_path)
        return result

    except Exception as e:
        result["action"] = "error"
        result["reason"] = str(e)
        return result


def migrate_life_folder(life_dir: Path, dry_run: bool = False) -> dict:
    """Migrate all life files in a folder."""
    results = {
        "status": "success",
        "migrated": [],
        "skipped": [],
        "errors": []
    }

    if not life_dir.exists():
        results["status"] = "error"
        results["errors"].append(f"Life directory does not exist: {life_dir}")
        return results

    # Find all markdown files
    md_files = list(life_dir.rglob("*.md"))

    for file_path in md_files:
        # Skip backup files
        if ".backups" in str(file_path):
            continue

        result = migrate_file(file_path, dry_run)

        if result["action"] == "migrated" or result["action"] == "would_migrate":
            results["migrated"].append(result["file"])
        elif result["action"] == "error":
            results["errors"].append(result)
        else:
            results["skipped"].append(result["file"])

    return results


def main():
    try:
        # Check if running as tool (stdin has JSON) or CLI
        if not sys.stdin.isatty():
            input_data = json.loads(sys.stdin.read())
            tenant_id = input_data.get("tenant_id")
            dry_run = input_data.get("dry_run", False)

            if tenant_id:
                life_dir = Path("tenants") / tenant_id / "life"
            else:
                life_dir = Path("life")
        else:
            # CLI mode
            import argparse
            parser = argparse.ArgumentParser(description="Migrate life files to frontmatter format")
            parser.add_argument("--tenant", help="Tenant ID to migrate")
            parser.add_argument("--dry-run", action="store_true", help="Preview changes")
            args = parser.parse_args()

            dry_run = args.dry_run
            if args.tenant:
                life_dir = Path("tenants") / args.tenant / "life"
            else:
                life_dir = Path("life")

        results = migrate_life_folder(life_dir, dry_run)

        print(json.dumps(results, indent=2))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
