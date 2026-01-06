#!/usr/bin/env python3
"""
mark_question_answered.py - Mark an onboarding question as answered.

Input JSON:
{
    "question": "What should I call you?",
    "answer": "Anden",
    "category": "identity|work|communication|boundaries|tools"
}

Output JSON:
{
    "status": "success",
    "message": "Question marked as answered",
    "progress": {
        "asked": 5,
        "answered": 3
    }
}
"""

import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path


def call_life_write(file_name: str, operation: str, path: str, value) -> dict:
    """Call life_write.py with the given parameters."""
    script_path = Path(__file__).parent / "life_write.py"

    input_data = {
        "file": file_name,
        "operation": operation,
        "path": path,
        "value": value
    }

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            try:
                return json.loads(result.stdout)
            except:
                return {"status": "error", "message": result.stderr or "Unknown error"}

    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "life_write.py timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def call_life_read(file_name: str) -> dict:
    """Call life_read.py to get current data."""
    script_path = Path(__file__).parent / "life_read.py"

    input_data = {"file": file_name}

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            return {"status": "error", "message": result.stderr or "Unknown error"}

    except Exception as e:
        return {"status": "error", "message": str(e)}


def generate_id() -> str:
    """Generate a simple unique ID."""
    import uuid
    return str(uuid.uuid4())[:8]


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        question = input_data.get("question")
        answer = input_data.get("answer")
        category = input_data.get("category", "general")

        if not question:
            raise ValueError("Missing required field: question")
        if not answer:
            raise ValueError("Missing required field: answer")

        # Create answered question entry
        answered_entry = {
            "id": generate_id(),
            "question": question,
            "answer": answer,
            "category": category,
            "priority": "medium",
            "answeredAt": datetime.utcnow().isoformat() + "Z"
        }

        # Add to questions.md answered array
        result = call_life_write("questions", "append", "answered", answered_entry)

        if result.get("status") != "success":
            print(json.dumps(result))
            sys.exit(1)

        # Get current questions data to calculate progress
        questions_data = call_life_read("questions")
        pending_count = len(questions_data.get("data", {}).get("pending", []))
        answered_count = len(questions_data.get("data", {}).get("answered", []))

        # Update onboarding progress
        onboarding_path = Path("life") / "onboarding.md"
        if onboarding_path.exists():
            call_life_write("onboarding.md", "merge", None, {
                "questionsAnswered": answered_count,
                "questionsAsked": pending_count + answered_count
            })

        print(json.dumps({
            "status": "success",
            "message": f"Question marked as answered: {question[:50]}...",
            "progress": {
                "pending": pending_count,
                "answered": answered_count
            }
        }))

    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
