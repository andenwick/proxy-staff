#!/usr/bin/env python3
"""
add_question.py - Add a discovery question to the tenant's question queue.

Input JSON:
{
    "question": "What is your preferred communication style?",
    "priority": "high|medium",  // Optional, defaults to "medium"
    "reason": "Noticed varying response lengths"  // Optional
}

Output JSON:
{
    "status": "success",
    "file": "life/questions.md",
    "message": "Question added to queue"
}
"""

import sys
import json
from datetime import datetime
from pathlib import Path


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        question = input_data.get("question")
        priority = input_data.get("priority", "medium")
        reason = input_data.get("reason", "")

        if not question:
            raise ValueError("Missing required field: question")

        if priority not in ["high", "medium"]:
            priority = "medium"

        # Path to questions file
        questions_path = Path("life") / "questions.md"
        questions_path.parent.mkdir(parents=True, exist_ok=True)

        # Read current content
        content = ""
        if questions_path.exists():
            with open(questions_path, "r", encoding="utf-8") as f:
                content = f.read()

        # Find the appropriate section
        section_header = f"## {'High' if priority == 'high' else 'Medium'} Priority"

        # Format the question entry
        date_str = datetime.now().strftime("%Y-%m-%d")
        reason_text = f" ({reason})" if reason else ""
        entry = f"- [ ] {question}{reason_text} - added {date_str}\n"

        # Insert the question in the right section
        if section_header in content:
            # Find the section and add after it
            lines = content.split("\n")
            new_lines = []
            inserted = False

            for i, line in enumerate(lines):
                new_lines.append(line)
                if line.strip() == section_header and not inserted:
                    new_lines.append(entry.rstrip())
                    inserted = True

            content = "\n".join(new_lines)
        else:
            # Section doesn't exist, create minimal structure
            if not content.strip():
                content = "# Discovery Questions\n\n## High Priority\n\n## Medium Priority\n\n## Asked & Answered\n"

            # Try again with the new content
            lines = content.split("\n")
            new_lines = []
            inserted = False

            for line in lines:
                new_lines.append(line)
                if line.strip() == section_header and not inserted:
                    new_lines.append(entry.rstrip())
                    inserted = True

            if inserted:
                content = "\n".join(new_lines)
            else:
                # Fallback: just append
                content += f"\n{entry}"

        # Write back
        with open(questions_path, "w", encoding="utf-8") as f:
            f.write(content)

        result = {
            "status": "success",
            "file": str(questions_path),
            "message": "Question added to queue"
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
