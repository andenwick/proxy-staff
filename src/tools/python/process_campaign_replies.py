#!/usr/bin/env python3
"""
process_campaign_replies.py - Check and process replies from campaign targets

This tool:
1. Checks Gmail for recent emails from campaign target addresses
2. Analyzes reply content for intent/sentiment
3. Updates target stages based on analysis
4. Detects and handles unsubscribes

Input JSON:
{
    "campaign": "optional - filter to specific campaign",
    "hours_back": 24,  # How far back to check (default 24)
    "dry_run": false   # If true, analyze but don't update
}

Output JSON:
{
    "status": "success",
    "replies_found": 5,
    "processed": 4,
    "unsubscribes": 1,
    "positive": 2,
    "negative": 1,
    "details": [...]
}
"""

import sys
import json
import subprocess
import re
from pathlib import Path
from datetime import datetime, timedelta


def load_env_from_cwd():
    """Load .env file from current working directory."""
    env_path = Path.cwd() / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                import os
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# Intent detection patterns
INTENT_PATTERNS = {
    "interested": [
        "interested", "tell me more", "sounds good", "let's chat",
        "let's talk", "would love to", "yes please", "send me",
        "share more", "learn more", "curious about"
    ],
    "meeting_request": [
        "schedule a call", "book a meeting", "set up a time", "calendar",
        "available", "free time", "next week", "this week", "tomorrow",
        "let's meet", "15 minutes", "30 minutes", "quick call"
    ],
    "not_interested": [
        "not interested", "no thank you", "no thanks", "not a good fit",
        "not for us", "pass on this", "not right now", "maybe later",
        "not at this time", "we're all set", "already have"
    ],
    "unsubscribe": [
        "unsubscribe", "stop emailing", "stop contacting", "remove me",
        "opt out", "opt-out", "do not contact", "leave me alone",
        "remove my email", "take me off"
    ],
    "out_of_office": [
        "out of office", "on vacation", "away from", "limited access",
        "return on", "back on", "auto-reply", "automatic reply"
    ],
    "question": [
        "how does", "what is", "can you explain", "more information",
        "how much", "pricing", "cost", "features", "?"
    ]
}


def analyze_reply(content: str) -> dict:
    """Analyze reply content for intent and sentiment."""
    lower_content = content.lower()
    matched_keywords = []
    intent_scores = {}

    # Score each intent
    for intent, patterns in INTENT_PATTERNS.items():
        intent_scores[intent] = 0
        for pattern in patterns:
            if pattern.lower() in lower_content:
                intent_scores[intent] += 1
                matched_keywords.append(pattern)

    # Find highest scoring intent
    top_intent = "unknown"
    top_score = 0
    for intent, score in intent_scores.items():
        if score > top_score:
            top_score = score
            top_intent = intent

    # Determine sentiment and suggested action
    sentiment = "neutral"
    suggested_stage = None
    suggested_action = None

    if top_intent == "unsubscribe":
        sentiment = "negative"
        suggested_stage = "lost"
        suggested_action = "mark_unsubscribed"
    elif top_intent == "interested":
        sentiment = "positive"
        suggested_stage = "replied"
        suggested_action = "follow_up_with_details"
    elif top_intent == "meeting_request":
        sentiment = "positive"
        suggested_stage = "qualified"
        suggested_action = "schedule_meeting"
    elif top_intent == "not_interested":
        sentiment = "negative"
        suggested_stage = "lost"
        suggested_action = "close_target"
    elif top_intent == "out_of_office":
        sentiment = "neutral"
        suggested_action = "wait_and_retry"
    elif top_intent == "question":
        sentiment = "neutral"
        suggested_stage = "replied"
        suggested_action = "answer_question"
    else:
        suggested_stage = "replied"
        suggested_action = "review_manually"

    confidence = min(0.9, 0.3 + (top_score * 0.15))

    return {
        "sentiment": sentiment,
        "intent": top_intent,
        "confidence": confidence,
        "suggested_stage": suggested_stage,
        "suggested_action": suggested_action,
        "keywords_matched": matched_keywords
    }


def get_campaign_target_emails(campaign_name: str = None) -> dict:
    """Get all target emails from campaigns."""
    target_emails = {}  # email -> {campaign, target_id, name}

    campaigns_dir = Path("operations") / "campaigns"
    if not campaigns_dir.exists():
        return target_emails

    for campaign_path in campaigns_dir.iterdir():
        if not campaign_path.is_dir():
            continue

        if campaign_name and campaign_path.name != campaign_name.lower().replace(" ", "-"):
            continue

        targets_file = campaign_path / "targets.md"
        if not targets_file.exists():
            continue

        # Parse frontmatter
        content = targets_file.read_text(encoding="utf-8")
        match = re.match(r'^---json\s*\n(.*?)\n---', content, re.DOTALL)
        if not match:
            continue

        try:
            data = json.loads(match.group(1))
            for target in data.get("targets", []):
                email = target.get("email")
                if email:
                    target_emails[email.lower()] = {
                        "campaign": campaign_path.name,
                        "target_id": target.get("id"),
                        "target_name": target.get("name"),
                        "current_stage": target.get("stage")
                    }
        except json.JSONDecodeError:
            continue

    return target_emails


def search_gmail(query: str, max_results: int = 50) -> list:
    """Search Gmail using the gmail_search tool."""
    try:
        gmail_script = Path(__file__).parent.parent.parent / "tools" / "python" / "gmail_search.py"
        if not gmail_script.exists():
            # Try execution folder
            gmail_script = Path("execution") / "gmail_search.py"

        if not gmail_script.exists():
            return []

        result = subprocess.run(
            ["python", str(gmail_script)],
            input=json.dumps({"query": query, "max_results": max_results}),
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            output = json.loads(result.stdout)
            return output.get("emails", [])
        return []
    except Exception:
        return []


def read_gmail(email_id: str) -> dict:
    """Read a specific email using gmail_read tool."""
    try:
        gmail_script = Path(__file__).parent.parent.parent / "tools" / "python" / "gmail_read.py"
        if not gmail_script.exists():
            gmail_script = Path("execution") / "gmail_read.py"

        if not gmail_script.exists():
            return {}

        result = subprocess.run(
            ["python", str(gmail_script)],
            input=json.dumps({"email_id": email_id}),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        return {}
    except Exception:
        return {}


def update_target_stage(campaign: str, target_id: str, stage: str) -> bool:
    """Update target stage using campaign_write tool."""
    try:
        script = Path(__file__).parent / "campaign_write.py"
        result = subprocess.run(
            ["python", str(script)],
            input=json.dumps({
                "operation": "update_target",
                "campaign": campaign,
                "target_id": target_id,
                "data": {"stage": stage}
            }),
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.returncode == 0
    except Exception:
        return False


def load_processed_ids() -> set:
    """Load already processed email IDs."""
    state_file = Path("state") / "processed_replies.json"
    if state_file.exists():
        try:
            data = json.loads(state_file.read_text())
            return set(data.get("processed_ids", []))
        except Exception:
            pass
    return set()


def save_processed_ids(ids: set):
    """Save processed email IDs."""
    state_dir = Path("state")
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / "processed_replies.json"

    # Keep only last 1000
    ids_list = list(ids)[-1000:]

    data = {
        "processed_ids": ids_list,
        "last_updated": datetime.utcnow().isoformat() + "Z"
    }
    state_file.write_text(json.dumps(data, indent=2))


def main():
    try:
        load_env_from_cwd()

        input_data = {}
        stdin_content = sys.stdin.read().strip()
        if stdin_content:
            input_data = json.loads(stdin_content)

        campaign_filter = input_data.get("campaign")
        hours_back = input_data.get("hours_back", 24)
        dry_run = input_data.get("dry_run", False)

        # Get target emails from campaigns
        target_emails = get_campaign_target_emails(campaign_filter)

        if not target_emails:
            result = {
                "status": "success",
                "message": "No campaign targets found",
                "replies_found": 0,
                "processed": 0
            }
            print(json.dumps(result))
            return

        # Build Gmail query for target emails
        # Search for emails from any of the target addresses
        email_list = list(target_emails.keys())[:20]  # Limit to avoid query too long
        query_parts = [f"from:{email}" for email in email_list]
        query = f"newer_than:{hours_back}h ({' OR '.join(query_parts)})"

        # Search Gmail
        emails = search_gmail(query, max_results=100)

        if not emails:
            result = {
                "status": "success",
                "message": "No replies found in Gmail",
                "replies_found": 0,
                "processed": 0
            }
            print(json.dumps(result))
            return

        # Load processed IDs
        processed_ids = load_processed_ids()

        # Process each reply
        details = []
        unsubscribes = 0
        positive = 0
        negative = 0
        processed = 0

        for email in emails:
            email_id = email.get("id")
            if not email_id or email_id in processed_ids:
                continue

            from_email = email.get("from", "").lower()
            # Extract email address from "Name <email@example.com>" format
            email_match = re.search(r'<([^>]+)>', from_email)
            if email_match:
                from_email = email_match.group(1).lower()

            # Check if from a target
            if from_email not in target_emails:
                continue

            target_info = target_emails[from_email]

            # Read full email content
            full_email = read_gmail(email_id)
            body = full_email.get("body", email.get("snippet", ""))

            # Analyze reply
            analysis = analyze_reply(body)

            detail = {
                "email_id": email_id,
                "from": from_email,
                "target_name": target_info.get("target_name"),
                "campaign": target_info.get("campaign"),
                "subject": email.get("subject", ""),
                "analysis": analysis
            }

            # Update counts
            if analysis["intent"] == "unsubscribe":
                unsubscribes += 1
            elif analysis["sentiment"] == "positive":
                positive += 1
            elif analysis["sentiment"] == "negative":
                negative += 1

            # Update target stage if not dry run
            if not dry_run and analysis["suggested_stage"]:
                current_stage = target_info.get("current_stage")
                suggested_stage = analysis["suggested_stage"]

                # Stage progression order
                stages = ["identified", "researched", "contacted", "replied", "qualified", "booked", "won", "lost"]
                current_idx = stages.index(current_stage) if current_stage in stages else 0
                suggested_idx = stages.index(suggested_stage) if suggested_stage in stages else 0

                # Only advance (or mark lost)
                if suggested_stage == "lost" or suggested_idx > current_idx:
                    success = update_target_stage(
                        target_info["campaign"],
                        target_info["target_id"],
                        suggested_stage
                    )
                    detail["stage_updated"] = success
                    detail["new_stage"] = suggested_stage if success else None

            details.append(detail)
            processed += 1
            processed_ids.add(email_id)

        # Save processed IDs
        if not dry_run:
            save_processed_ids(processed_ids)

        result = {
            "status": "success",
            "replies_found": len(emails),
            "processed": processed,
            "unsubscribes": unsubscribes,
            "positive": positive,
            "negative": negative,
            "dry_run": dry_run,
            "details": details
        }
        print(json.dumps(result, indent=2))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
