#!/usr/bin/env python3
"""
campaign_write.py - Write/update campaign data in operations/campaigns/

Input JSON:
{
    "campaign": "campaign-name",
    "operation": "create|update_config|add_target|add_target_by_prospect|update_target|update_target_stage_sync|record_touch|log_event",
    "data": { ... },
    "target_id": "optional target ID for target operations",
    "prospect_slug": "optional prospect slug for add_target_by_prospect"
}

Operations:
- create: Create new campaign with config
- update_config: Update campaign config
- add_target: Add new target to campaign (legacy, inline data)
- add_target_by_prospect: Add target by prospect slug (new reference format)
- update_target: Update existing target (stage, research, etc.)
- update_target_stage_sync: Update target stage and sync to prospect file
- record_touch: Record an outreach touch for a target
- log_event: Add event to campaign log

Output JSON:
{
    "status": "success",
    "message": "...",
    "campaign_path": "operations/campaigns/q1-outreach",
    "data": { ... }
}
"""

import sys
import json
import re
import uuid
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


def sanitize_name(name: str) -> str:
    """Convert campaign name to safe folder name."""
    return re.sub(r'[^a-z0-9-]', '-', name.lower())


def get_campaign_path(campaign_name: str) -> Path:
    """Get the path to a campaign folder."""
    safe_name = sanitize_name(campaign_name)
    return Path("operations") / "campaigns" / safe_name


def get_prospects_folder() -> Path:
    """Get the path to prospects folder."""
    return Path("relationships") / "prospects"


def generate_id() -> str:
    """Generate a unique ID."""
    return str(uuid.uuid4())


def get_default_config(name: str, owner_phone: str = "", goal: str = "") -> dict:
    """Get default campaign config."""
    return {
        "version": 1,
        "id": generate_id(),
        "name": name,
        "status": "draft",
        "owner_phone": owner_phone,
        "goal": goal,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "audience": {
            "description": "",
            "industries": [],
            "company_size": "",
            "titles": [],
            "locations": []
        },
        "channels": {
            "email": {"enabled": True, "templates": []},
            "linkedin": {"enabled": False, "templates": []},
            "sms": {"enabled": False, "templates": []},
            "calls": {"enabled": False, "scripts": []}
        },
        "settings": {
            "max_daily_outreach": 20,
            "min_days_between_touches": 3,
            "max_touches_per_target": 5,
            "require_approval": True,
            "auto_research": True
        }
    }


def get_default_targets_v2() -> dict:
    """Get default targets structure (v2 with references)."""
    return {
        "version": 2,
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "target_references": []
    }


def get_default_targets() -> dict:
    """Get default targets structure (legacy)."""
    return {
        "version": 1,
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "targets": []
    }


def get_default_metrics() -> dict:
    """Get default metrics structure."""
    return {
        "version": 1,
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_targets": 0,
            "by_stage": {},
            "emails_sent": 0,
            "emails_opened": 0,
            "replies_received": 0,
            "meetings_booked": 0
        },
        "daily": []
    }


def get_default_log() -> dict:
    """Get default log structure."""
    return {
        "version": 1,
        "events": []
    }


def read_campaign_file(campaign_path: Path, file_name: str) -> tuple[dict, str]:
    """Read a campaign file, return data and markdown."""
    file_path = campaign_path / f"{file_name}.md"

    if not file_path.exists():
        # Return defaults based on file type
        if file_name == "targets":
            return get_default_targets_v2(), ""
        elif file_name == "metrics":
            return get_default_metrics(), ""
        elif file_name == "log":
            return get_default_log(), ""
        return {}, ""

    content = file_path.read_text(encoding="utf-8")
    return parse_frontmatter(content)


def write_campaign_file(campaign_path: Path, file_name: str, data: dict, markdown: str = ""):
    """Write a campaign file."""
    file_path = campaign_path / f"{file_name}.md"
    content = serialize_frontmatter(data, markdown)
    file_path.write_text(content, encoding="utf-8")


def read_prospect(slug: str) -> dict | None:
    """Read a prospect file by slug."""
    prospects_folder = get_prospects_folder()
    file_path = prospects_folder / f"{slug}.md"

    if not file_path.exists():
        return None

    content = file_path.read_text(encoding="utf-8")
    frontmatter, _ = parse_frontmatter(content)
    return frontmatter


def update_prospect_stage(slug: str, new_stage: str):
    """Update a prospect's stage."""
    prospects_folder = get_prospects_folder()
    file_path = prospects_folder / f"{slug}.md"

    if not file_path.exists():
        raise ValueError(f"Prospect '{slug}' not found")

    content = file_path.read_text(encoding="utf-8")
    frontmatter, markdown = parse_frontmatter(content)

    frontmatter["stage"] = new_stage
    frontmatter["updated_at"] = datetime.utcnow().isoformat() + "Z"

    new_content = serialize_frontmatter(frontmatter, markdown)
    file_path.write_text(new_content, encoding="utf-8")


def create_campaign(name: str, data: dict) -> dict:
    """Create a new campaign with all required files."""
    campaign_path = get_campaign_path(name)

    if campaign_path.exists():
        raise ValueError(f"Campaign '{name}' already exists at {campaign_path}")

    # Create campaign directory
    campaign_path.mkdir(parents=True, exist_ok=True)

    # Create config
    config = get_default_config(name)
    if data:
        # Merge provided data
        for key in ["owner_phone", "goal", "status"]:
            if key in data:
                config[key] = data[key]
        if "audience" in data:
            config["audience"].update(data["audience"])
        if "channels" in data:
            for ch, ch_data in data["channels"].items():
                if ch in config["channels"]:
                    config["channels"][ch].update(ch_data)
        if "settings" in data:
            config["settings"].update(data["settings"])

    write_campaign_file(campaign_path, "config", config, f"\n# {name}\n\nCampaign goal: {config['goal']}\n")

    # Create targets file (v2 format)
    targets = get_default_targets_v2()
    write_campaign_file(campaign_path, "targets", targets, "\n# Campaign Targets\n")

    # Create sequence file (empty template)
    sequence = {
        "version": 1,
        "stages": [
            {"name": "identified", "description": "Target identified, not yet researched"},
            {"name": "researched", "description": "Research completed, ready for outreach"},
            {"name": "contacted", "description": "Initial outreach sent"},
            {"name": "replied", "description": "Received response from target"},
            {"name": "qualified", "description": "Target qualified as potential customer"},
            {"name": "booked", "description": "Meeting or call scheduled"},
            {"name": "won", "description": "Deal closed successfully"},
            {"name": "lost", "description": "Target declined or unresponsive"}
        ],
        "sequences": []
    }
    write_campaign_file(campaign_path, "sequence", sequence, "\n# Outreach Sequences\n")

    # Create metrics file
    metrics = get_default_metrics()
    write_campaign_file(campaign_path, "metrics", metrics, "\n# Campaign Metrics\n")

    # Create log file
    log_data = get_default_log()
    log_data["events"].append({
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "CREATED",
        "message": f"Campaign '{name}' created"
    })
    write_campaign_file(campaign_path, "log", log_data, "\n# Campaign Log\n")

    return config


def update_config(campaign_name: str, updates: dict) -> dict:
    """Update campaign config."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "config")

    # Apply updates
    for key in ["status", "goal", "owner_phone"]:
        if key in updates:
            data[key] = updates[key]
    if "audience" in updates:
        data["audience"].update(updates["audience"])
    if "channels" in updates:
        for ch, ch_data in updates["channels"].items():
            if ch in data["channels"]:
                data["channels"][ch].update(ch_data)
    if "settings" in updates:
        data["settings"].update(updates["settings"])

    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "config", data, markdown)

    return data


def add_target_by_prospect(campaign_name: str, prospect_slug: str) -> dict:
    """Add a target to campaign by prospect slug (new reference format)."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    # Verify prospect exists
    prospect = read_prospect(prospect_slug)
    if prospect is None:
        raise ValueError(f"Prospect '{prospect_slug}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    now = datetime.utcnow().isoformat() + "Z"

    # Create target reference
    target_ref = {
        "id": generate_id(),
        "prospect_slug": prospect_slug,
        "added_at": now,
        "last_touch_at": None,
        "touch_count": 0,
        "campaign_stage": "identified",
        "unsubscribed": False
    }

    # Handle both formats
    if "target_references" in data:
        data["target_references"].append(target_ref)
    else:
        # Migrate to v2 format
        data = {
            "version": 2,
            "lastUpdated": now,
            "target_references": [target_ref]
        }

    data["lastUpdated"] = now

    write_campaign_file(campaign_path, "targets", data, markdown)

    # Update metrics
    update_metrics_count_v2(campaign_path)

    return target_ref


def add_target(campaign_name: str, target_data: dict) -> dict:
    """Add a new target to the campaign (legacy inline format)."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    # Create new target
    target = {
        "id": generate_id(),
        "stage": target_data.get("stage", "identified"),
        "name": target_data.get("name", "Unknown"),
        "email": target_data.get("email"),
        "linkedin": target_data.get("linkedin"),
        "phone": target_data.get("phone"),
        "company": target_data.get("company"),
        "title": target_data.get("title"),
        "research": target_data.get("research"),
        "notes": target_data.get("notes"),
        "touches": [],
        "next_action": None,
        "unsubscribed": False,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "stage_changed_at": datetime.utcnow().isoformat() + "Z"
    }

    # Handle legacy format
    if "targets" not in data:
        data["targets"] = []

    data["targets"].append(target)
    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "targets", data, markdown)

    # Update metrics
    update_metrics_count(campaign_path)

    return target


def update_target_stage_sync(campaign_name: str, target_id: str, new_stage: str) -> dict:
    """Update target stage and sync to prospect file."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    if "target_references" not in data:
        raise ValueError("Campaign uses legacy format - use update_target instead")

    # Find target reference
    target_ref = None
    for ref in data["target_references"]:
        if ref["id"] == target_id:
            target_ref = ref
            break

    if not target_ref:
        raise ValueError(f"Target '{target_id}' not found")

    old_stage = target_ref.get("campaign_stage")
    target_ref["campaign_stage"] = new_stage

    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "targets", data, markdown)

    # Sync stage to prospect file
    update_prospect_stage(target_ref["prospect_slug"], new_stage)

    # Update metrics
    update_metrics_count_v2(campaign_path)

    return target_ref


def update_target(campaign_name: str, target_id: str, updates: dict) -> dict:
    """Update an existing target (handles both formats)."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    # Try v2 format first
    if "target_references" in data:
        for ref in data["target_references"]:
            if ref["id"] == target_id:
                # Update allowed fields
                for key in ["campaign_stage", "unsubscribed"]:
                    if key in updates:
                        ref[key] = updates[key]
                if "last_touch_at" in updates:
                    ref["last_touch_at"] = updates["last_touch_at"]
                if "touch_count" in updates:
                    ref["touch_count"] = updates["touch_count"]

                data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"
                write_campaign_file(campaign_path, "targets", data, markdown)
                update_metrics_count_v2(campaign_path)
                return ref

    # Try legacy format
    if "targets" in data:
        for target in data["targets"]:
            if target["id"] == target_id:
                old_stage = target.get("stage")
                new_stage = updates.get("stage")

                for key in ["stage", "name", "email", "linkedin", "phone", "company", "title", "research", "notes", "next_action", "unsubscribed"]:
                    if key in updates:
                        target[key] = updates[key]

                if new_stage and new_stage != old_stage:
                    target["stage_changed_at"] = datetime.utcnow().isoformat() + "Z"

                data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"
                write_campaign_file(campaign_path, "targets", data, markdown)

                if new_stage and new_stage != old_stage:
                    update_metrics_count(campaign_path)

                return target

    raise ValueError(f"Target '{target_id}' not found")


def record_touch(campaign_name: str, target_id: str, touch_data: dict) -> dict:
    """Record an outreach touch for a target."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    now = datetime.utcnow().isoformat() + "Z"

    # Handle v2 format
    if "target_references" in data:
        for ref in data["target_references"]:
            if ref["id"] == target_id:
                ref["last_touch_at"] = now
                ref["touch_count"] = ref.get("touch_count", 0) + 1

                # Update stage to contacted if identified or researched
                if ref.get("campaign_stage") in ["identified", "researched"]:
                    ref["campaign_stage"] = "contacted"

                data["lastUpdated"] = now
                write_campaign_file(campaign_path, "targets", data, markdown)
                update_metrics_count_v2(campaign_path)

                return {
                    "id": generate_id(),
                    "channel": touch_data.get("channel", "email"),
                    "sent_at": now,
                    "status": "sent"
                }

    # Handle legacy format
    if "targets" in data:
        for target in data["targets"]:
            if target["id"] == target_id:
                touch = {
                    "id": generate_id(),
                    "channel": touch_data.get("channel", "email"),
                    "type": touch_data.get("type", "outreach"),
                    "subject": touch_data.get("subject"),
                    "body_preview": touch_data.get("body_preview"),
                    "sent_at": touch_data.get("sent_at", now),
                    "status": touch_data.get("status", "sent"),
                    "message_id": touch_data.get("message_id")
                }

                target["touches"].append(touch)
                data["lastUpdated"] = now

                write_campaign_file(campaign_path, "targets", data, markdown)
                update_touch_metrics(campaign_path, touch["channel"])

                return touch

    raise ValueError(f"Target '{target_id}' not found")


def log_event(campaign_name: str, event_type: str, message: str) -> dict:
    """Add event to campaign log."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "log")

    event = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": event_type,
        "message": message
    }

    data["events"].insert(0, event)  # Most recent first

    # Keep only last 1000 events
    if len(data["events"]) > 1000:
        data["events"] = data["events"][:1000]

    write_campaign_file(campaign_path, "log", data, markdown)

    return event


def update_metrics_count_v2(campaign_path: Path):
    """Update target count metrics (v2 format)."""
    targets_data, _ = read_campaign_file(campaign_path, "targets")
    metrics_data, metrics_md = read_campaign_file(campaign_path, "metrics")

    refs = targets_data.get("target_references", [])

    # Count by stage
    by_stage = {}
    total_touches = 0
    for ref in refs:
        stage = ref.get("campaign_stage", "unknown")
        by_stage[stage] = by_stage.get(stage, 0) + 1
        total_touches += ref.get("touch_count", 0)

    metrics_data["summary"]["total_targets"] = len(refs)
    metrics_data["summary"]["by_stage"] = by_stage
    metrics_data["summary"]["emails_sent"] = total_touches
    metrics_data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "metrics", metrics_data, metrics_md)


def update_metrics_count(campaign_path: Path):
    """Update target count metrics (legacy format)."""
    targets_data, _ = read_campaign_file(campaign_path, "targets")
    metrics_data, metrics_md = read_campaign_file(campaign_path, "metrics")

    targets = targets_data.get("targets", [])

    # Count by stage
    by_stage = {}
    for t in targets:
        stage = t.get("stage", "unknown")
        by_stage[stage] = by_stage.get(stage, 0) + 1

    metrics_data["summary"]["total_targets"] = len(targets)
    metrics_data["summary"]["by_stage"] = by_stage
    metrics_data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "metrics", metrics_data, metrics_md)


def update_touch_metrics(campaign_path: Path, channel: str):
    """Update touch metrics."""
    metrics_data, metrics_md = read_campaign_file(campaign_path, "metrics")

    if channel == "email":
        metrics_data["summary"]["emails_sent"] = metrics_data["summary"].get("emails_sent", 0) + 1

    metrics_data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "metrics", metrics_data, metrics_md)


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        campaign_name = input_data.get("campaign")
        operation = input_data.get("operation")
        data = input_data.get("data", {})
        target_id = input_data.get("target_id")
        prospect_slug = input_data.get("prospect_slug")

        if not operation:
            raise ValueError("Missing required field: operation")

        if operation == "create":
            if not campaign_name:
                campaign_name = data.get("name")
            if not campaign_name:
                raise ValueError("Missing campaign name")

            config = create_campaign(campaign_name, data)
            result = {
                "status": "success",
                "message": f"Campaign '{campaign_name}' created",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": config
            }

        elif operation == "update_config":
            if not campaign_name:
                raise ValueError("Missing campaign name")

            config = update_config(campaign_name, data)
            result = {
                "status": "success",
                "message": f"Campaign '{campaign_name}' config updated",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": config
            }

        elif operation == "add_target_by_prospect":
            if not campaign_name:
                raise ValueError("Missing campaign name")
            if not prospect_slug:
                prospect_slug = data.get("prospect_slug")
            if not prospect_slug:
                raise ValueError("Missing prospect_slug")

            target_ref = add_target_by_prospect(campaign_name, prospect_slug)
            result = {
                "status": "success",
                "message": f"Target reference added for prospect '{prospect_slug}'",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": target_ref
            }

        elif operation == "add_target":
            if not campaign_name:
                raise ValueError("Missing campaign name")

            target = add_target(campaign_name, data)
            result = {
                "status": "success",
                "message": f"Target '{target['name']}' added to campaign",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": target
            }

        elif operation == "update_target_stage_sync":
            if not campaign_name:
                raise ValueError("Missing campaign name")
            if not target_id:
                raise ValueError("Missing target_id")

            new_stage = data.get("stage")
            if not new_stage:
                raise ValueError("Missing stage in data")

            target_ref = update_target_stage_sync(campaign_name, target_id, new_stage)
            result = {
                "status": "success",
                "message": f"Target stage updated and synced to prospect",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": target_ref
            }

        elif operation == "update_target":
            if not campaign_name:
                raise ValueError("Missing campaign name")
            if not target_id:
                raise ValueError("Missing target_id")

            target = update_target(campaign_name, target_id, data)
            result = {
                "status": "success",
                "message": "Target updated",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": target
            }

        elif operation == "record_touch":
            if not campaign_name:
                raise ValueError("Missing campaign name")
            if not target_id:
                raise ValueError("Missing target_id")

            touch = record_touch(campaign_name, target_id, data)
            result = {
                "status": "success",
                "message": f"Touch recorded for target",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": touch
            }

        elif operation == "log_event":
            if not campaign_name:
                raise ValueError("Missing campaign name")

            event_type = data.get("type", "INFO")
            message = data.get("message", "")
            event = log_event(campaign_name, event_type, message)
            result = {
                "status": "success",
                "message": "Event logged",
                "campaign_path": str(get_campaign_path(campaign_name)),
                "data": event
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
