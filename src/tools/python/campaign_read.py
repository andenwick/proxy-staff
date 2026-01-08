#!/usr/bin/env python3
"""
campaign_read.py - Read campaign data from operations/campaigns/

Input JSON:
{
    "campaign": "campaign-name",
    "file": "config|targets|sequence|metrics|log",  # optional, defaults to config
    "query": "optional search term",
    "target_id": "optional target ID for specific target",
    "include_prospect": true  # optional, load prospect context for targets
}

Output JSON:
{
    "status": "success",
    "data": { ... },
    "markdown": "...",
    "campaign_path": "operations/campaigns/q1-outreach"
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


def get_campaign_path(campaign_name: str) -> Path:
    """Get the path to a campaign folder."""
    safe_name = re.sub(r'[^a-z0-9-]', '-', campaign_name.lower())
    return Path("operations") / "campaigns" / safe_name


def get_prospects_folder() -> Path:
    """Get the path to prospects folder."""
    return Path("relationships") / "prospects"


def read_prospect(slug: str) -> dict | None:
    """Read a prospect file by slug."""
    prospects_folder = get_prospects_folder()
    file_path = prospects_folder / f"{slug}.md"

    if not file_path.exists():
        return None

    content = file_path.read_text(encoding="utf-8")
    frontmatter, markdown = parse_frontmatter(content)

    # Parse body sections
    sections = parse_body_sections(markdown)

    return {
        "slug": slug,
        "frontmatter": frontmatter,
        **sections
    }


def parse_body_sections(markdown: str) -> dict:
    """Parse markdown body into sections."""
    sections = {
        "business_context": "",
        "research_notes": "",
        "personalization_hooks": "",
        "interaction_history": ""
    }

    parts = markdown.split("## ")

    for part in parts:
        if not part.strip():
            continue

        lines = part.split("\n")
        header = lines[0].strip()
        content = "\n".join(lines[1:]).strip()

        if header == "Business Context":
            sections["business_context"] = content
        elif header == "Research Notes":
            sections["research_notes"] = content
        elif header == "Personalization Hooks":
            sections["personalization_hooks"] = content
        elif header == "Interaction History":
            sections["interaction_history"] = content

    return sections


def list_campaigns() -> list[dict]:
    """List all campaigns."""
    campaigns_dir = Path("operations") / "campaigns"

    if not campaigns_dir.exists():
        return []

    campaigns = []
    for entry in campaigns_dir.iterdir():
        if entry.is_dir():
            config_path = entry / "config.md"
            if config_path.exists():
                try:
                    content = config_path.read_text(encoding="utf-8")
                    data, _ = parse_frontmatter(content)
                    campaigns.append({
                        "name": data.get("name", entry.name),
                        "id": data.get("id"),
                        "status": data.get("status", "unknown"),
                        "folder": entry.name
                    })
                except Exception:
                    campaigns.append({
                        "name": entry.name,
                        "status": "error",
                        "folder": entry.name
                    })

    return campaigns


def read_campaign_file(campaign_path: Path, file_name: str) -> tuple[dict, str]:
    """Read a specific campaign file."""
    file_path = campaign_path / f"{file_name}.md"

    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = file_path.read_text(encoding="utf-8")
    return parse_frontmatter(content)


def search_targets(data: dict, query: str) -> list[dict]:
    """Search targets by query string (legacy format)."""
    targets = data.get("targets", [])
    query_lower = query.lower()
    results = []

    for target in targets:
        searchable = f"{target.get('name', '')} {target.get('email', '')} {target.get('company', '')} {target.get('title', '')}".lower()
        if query_lower in searchable:
            results.append(target)

    return results


def get_target_by_id(data: dict, target_id: str) -> dict | None:
    """Get a specific target by ID (handles both old and new format)."""
    # Try new format first (target_references)
    if "target_references" in data:
        for ref in data["target_references"]:
            if ref.get("id") == target_id:
                return ref

    # Try old format (targets)
    if "targets" in data:
        for target in data["targets"]:
            if target.get("id") == target_id:
                return target

    return None


def get_target_with_context(data: dict, target_id: str) -> dict | None:
    """Get a target with its prospect context (new format)."""
    if "target_references" not in data:
        return None

    for ref in data["target_references"]:
        if ref.get("id") == target_id:
            prospect_slug = ref.get("prospect_slug")
            prospect = read_prospect(prospect_slug) if prospect_slug else None
            return {
                "target": ref,
                "prospect": prospect
            }

    return None


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        campaign_name = input_data.get("campaign")
        file_name = input_data.get("file", "config")
        query = input_data.get("query")
        target_id = input_data.get("target_id")
        include_prospect = input_data.get("include_prospect", False)

        # If no campaign specified, list all campaigns
        if not campaign_name:
            campaigns = list_campaigns()
            result = {
                "status": "success",
                "campaigns": campaigns,
                "count": len(campaigns)
            }
            print(json.dumps(result))
            return

        # Get campaign path
        campaign_path = get_campaign_path(campaign_name)

        if not campaign_path.exists():
            result = {
                "status": "error",
                "message": f"Campaign '{campaign_name}' not found at {campaign_path}"
            }
            print(json.dumps(result))
            sys.exit(1)

        # Read the requested file
        data, markdown = read_campaign_file(campaign_path, file_name)

        # Handle targets file with query/target_id
        if file_name == "targets":
            if target_id:
                # Get target with optional prospect context
                if include_prospect and "target_references" in data:
                    target_ctx = get_target_with_context(data, target_id)
                    if target_ctx:
                        result = {
                            "status": "success",
                            "target": target_ctx["target"],
                            "prospect": target_ctx["prospect"],
                            "campaign_path": str(campaign_path)
                        }
                    else:
                        result = {
                            "status": "error",
                            "message": f"Target '{target_id}' not found"
                        }
                        print(json.dumps(result))
                        sys.exit(1)
                else:
                    target = get_target_by_id(data, target_id)
                    if target:
                        result = {
                            "status": "success",
                            "target": target,
                            "campaign_path": str(campaign_path)
                        }
                    else:
                        result = {
                            "status": "error",
                            "message": f"Target '{target_id}' not found"
                        }
                        print(json.dumps(result))
                        sys.exit(1)
            elif query:
                # Search only works for legacy format
                matches = search_targets(data, query)
                result = {
                    "status": "success",
                    "targets": matches,
                    "total": len(data.get("targets", [])),
                    "matched": len(matches),
                    "campaign_path": str(campaign_path)
                }
            else:
                # Return all targets with summary
                # Handle both old and new format
                if "target_references" in data:
                    refs = data["target_references"]
                    by_stage = {}
                    for ref in refs:
                        stage = ref.get("campaign_stage", "unknown")
                        by_stage[stage] = by_stage.get(stage, 0) + 1

                    # Optionally include prospect data
                    targets_with_context = []
                    if include_prospect:
                        for ref in refs:
                            prospect_slug = ref.get("prospect_slug")
                            prospect = read_prospect(prospect_slug) if prospect_slug else None
                            targets_with_context.append({
                                "target": ref,
                                "prospect": prospect
                            })

                    result = {
                        "status": "success",
                        "format": "references",
                        "data": data,
                        "markdown": markdown,
                        "summary": {
                            "total_targets": len(refs),
                            "by_stage": by_stage
                        },
                        "campaign_path": str(campaign_path)
                    }

                    if include_prospect:
                        result["targets_with_context"] = targets_with_context
                else:
                    # Legacy format
                    targets = data.get("targets", [])
                    by_stage = {}
                    for t in targets:
                        stage = t.get("stage", "unknown")
                        by_stage[stage] = by_stage.get(stage, 0) + 1

                    result = {
                        "status": "success",
                        "format": "legacy",
                        "data": data,
                        "markdown": markdown,
                        "summary": {
                            "total_targets": len(targets),
                            "by_stage": by_stage
                        },
                        "campaign_path": str(campaign_path)
                    }
        else:
            result = {
                "status": "success",
                "data": data,
                "markdown": markdown,
                "campaign_path": str(campaign_path)
            }

        print(json.dumps(result))

    except FileNotFoundError as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
