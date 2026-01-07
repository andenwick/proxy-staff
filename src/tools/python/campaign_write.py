#!/usr/bin/env python3
"""
campaign_write.py - Write/update campaign data in operations/campaigns/

Input JSON:
{
    "campaign": "campaign-name",
    "operation": "create|update_config|add_target|update_target|record_touch|log_event",
    "data": { ... },
    "target_id": "optional target ID for target operations"
}

Operations:
- create: Create new campaign with config
- update_config: Update campaign config
- add_target: Add new target to campaign
- update_target: Update existing target (stage, research, etc.)
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


def get_default_targets() -> dict:
    """Get default targets structure."""
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
            return get_default_targets(), ""
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

    # Create targets file
    targets = get_default_targets()
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


def add_target(campaign_name: str, target_data: dict) -> dict:
    """Add a new target to the campaign."""
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

    data["targets"].append(target)
    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "targets", data, markdown)

    # Update metrics
    update_metrics_count(campaign_path)

    return target


def update_target(campaign_name: str, target_id: str, updates: dict) -> dict:
    """Update an existing target."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    # Find target
    target = None
    for t in data["targets"]:
        if t["id"] == target_id:
            target = t
            break

    if not target:
        raise ValueError(f"Target '{target_id}' not found")

    # Check if stage is changing
    old_stage = target.get("stage")
    new_stage = updates.get("stage")

    # Apply updates
    for key in ["stage", "name", "email", "linkedin", "phone", "company", "title", "research", "notes", "next_action", "unsubscribed"]:
        if key in updates:
            target[key] = updates[key]

    # Update stage_changed_at if stage changed
    if new_stage and new_stage != old_stage:
        target["stage_changed_at"] = datetime.utcnow().isoformat() + "Z"

    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "targets", data, markdown)

    # Update metrics if stage changed
    if new_stage and new_stage != old_stage:
        update_metrics_count(campaign_path)

    return target


def record_touch(campaign_name: str, target_id: str, touch_data: dict) -> dict:
    """Record an outreach touch for a target."""
    campaign_path = get_campaign_path(campaign_name)

    if not campaign_path.exists():
        raise ValueError(f"Campaign '{campaign_name}' not found")

    data, markdown = read_campaign_file(campaign_path, "targets")

    # Find target
    target = None
    for t in data["targets"]:
        if t["id"] == target_id:
            target = t
            break

    if not target:
        raise ValueError(f"Target '{target_id}' not found")

    # Create touch record
    touch = {
        "id": generate_id(),
        "channel": touch_data.get("channel", "email"),
        "type": touch_data.get("type", "outreach"),
        "subject": touch_data.get("subject"),
        "body_preview": touch_data.get("body_preview"),
        "sent_at": touch_data.get("sent_at", datetime.utcnow().isoformat() + "Z"),
        "status": touch_data.get("status", "sent"),
        "message_id": touch_data.get("message_id")
    }

    target["touches"].append(touch)
    data["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    write_campaign_file(campaign_path, "targets", data, markdown)

    # Update metrics
    update_touch_metrics(campaign_path, touch["channel"])

    return touch


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


def update_metrics_count(campaign_path: Path):
    """Update target count metrics."""
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

        elif operation == "update_target":
            if not campaign_name:
                raise ValueError("Missing campaign name")
            if not target_id:
                raise ValueError("Missing target_id")

            target = update_target(campaign_name, target_id, data)
            result = {
                "status": "success",
                "message": f"Target '{target['name']}' updated",
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
