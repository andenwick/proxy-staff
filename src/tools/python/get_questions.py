#!/usr/bin/env python3
"""
get_questions.py - Get pending discovery questions from the queue.

Input JSON:
{
    "priority": "high|medium|all"  // Optional, defaults to "all"
}

Output JSON:
{
    "status": "success",
    "questions": {
        "high": ["question 1", "question 2"],
        "medium": ["question 3"]
    },
    "total": 3
}
"""

import sys
import json
import re
from pathlib import Path


def parse_questions(content: str) -> dict:
    """Parse the questions.md file and extract pending questions."""
    questions = {
        "high": [],
        "medium": []
    }

    current_section = None
    lines = content.split("\n")

    for line in lines:
        line_stripped = line.strip()

        # Detect section headers
        if line_stripped == "## High Priority":
            current_section = "high"
        elif line_stripped == "## Medium Priority":
            current_section = "medium"
        elif line_stripped.startswith("## "):
            current_section = None  # Other section (like Asked & Answered)

        # Parse unchecked questions
        if current_section and line_stripped.startswith("- [ ]"):
            # Extract the question text (remove checkbox and trailing metadata)
            question_text = line_stripped[5:].strip()
            # Remove "- added YYYY-MM-DD" suffix if present
            question_text = re.sub(r'\s*-\s*added\s+\d{4}-\d{2}-\d{2}\s*$', '', question_text)
            if question_text:
                questions[current_section].append(question_text)

    return questions


def main():
    try:
        input_data = json.loads(sys.stdin.read()) if sys.stdin.read().strip() else {}

        # Re-read stdin if empty (handle case where stdin was already consumed)
        if not input_data:
            input_data = {}

        priority = input_data.get("priority", "all")

        # Path to questions file
        questions_path = Path("life") / "questions.md"

        if not questions_path.exists():
            result = {
                "status": "success",
                "questions": {"high": [], "medium": []},
                "total": 0,
                "message": "No questions file found"
            }
            print(json.dumps(result))
            return

        with open(questions_path, "r", encoding="utf-8") as f:
            content = f.read()

        all_questions = parse_questions(content)

        # Filter by priority if specified
        if priority == "high":
            questions = {"high": all_questions["high"]}
        elif priority == "medium":
            questions = {"medium": all_questions["medium"]}
        else:
            questions = all_questions

        total = sum(len(q) for q in questions.values())

        result = {
            "status": "success",
            "questions": questions,
            "total": total
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
    # Handle empty stdin case
    import io
    stdin_content = sys.stdin.read()
    if stdin_content.strip():
        sys.stdin = io.StringIO(stdin_content)
    else:
        sys.stdin = io.StringIO("{}")

    main()
