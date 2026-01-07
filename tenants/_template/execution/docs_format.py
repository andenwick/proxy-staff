#!/usr/bin/env python3
"""
Apply text/paragraph formatting to a Google Doc using a single batchUpdate request.

Required environment variables:
- GOOGLE_DRIVE_CLIENT_ID
- GOOGLE_DRIVE_CLIENT_SECRET
- GOOGLE_DRIVE_REFRESH_TOKEN
"""

import json
import sys
import urllib.request
import urllib.error

from google_drive_utils import get_access_token


DOCS_API_BASE = "https://docs.googleapis.com/v1"


def docs_request(access_token, path, payload):
    url = DOCS_API_BASE + path
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Authorization", f"Bearer {access_token}")
    request.add_header("Content-Type", "application/json; charset=utf-8")

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Docs API request failed: {exc.code} {body}")


def docs_get(access_token, doc_id):
    url = f"{DOCS_API_BASE}/documents/{doc_id}"
    request = urllib.request.Request(url, method="GET")
    request.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Docs API request failed: {exc.code} {body}")


def extract_text_with_indices(document):
    text = []
    index_map = []
    body = document.get("body", {})
    for element in body.get("content", []):
        paragraph = element.get("paragraph")
        if not paragraph:
            continue
        for part in paragraph.get("elements", []):
            text_run = part.get("textRun")
            if not text_run:
                continue
            content = text_run.get("content", "")
            start_index = part.get("startIndex")
            if start_index is None:
                continue
            for offset, ch in enumerate(content):
                text.append(ch)
                index_map.append(start_index + offset)
    return "".join(text), index_map


def get_doc_end_index(document):
    body = document.get("body", {})
    content = body.get("content", [])
    if not content:
        return 1
    last = content[-1]
    return last.get("endIndex", 1)


def find_matches(text, needle, match_all=False):
    matches = []
    if not needle:
        return matches
    start = 0
    while True:
        idx = text.find(needle, start)
        if idx == -1:
            break
        matches.append(idx)
        if not match_all:
            break
        start = idx + len(needle)
    return matches


def ranges_from_match(text, index_map, needle, match_all=False):
    results = []
    for idx in find_matches(text, needle, match_all=match_all):
        end_offset = idx + len(needle) - 1
        if end_offset >= len(index_map):
            continue
        start_index = index_map[idx]
        end_index = index_map[end_offset] + 1
        results.append({"startIndex": start_index, "endIndex": end_index})
    return results


def resolve_ranges(op, document, text, index_map):
    if op.get("target") == "document":
        end_index = get_doc_end_index(document)
        return [{"startIndex": 1, "endIndex": max(2, end_index - 1)}]

    if op.get("range"):
        start = op["range"].get("start_index")
        end = op["range"].get("end_index")
        if isinstance(start, int) and isinstance(end, int) and end > start:
            return [{"startIndex": start, "endIndex": end}]
        raise ValueError("Invalid range: start_index/end_index required")

    match = op.get("match")
    if match:
        return ranges_from_match(text, index_map, match, match_all=bool(op.get("match_all")))

    raise ValueError("No target specified for range operation")


def resolve_insert_index(op, document, text, index_map):
    if isinstance(op.get("index"), int):
        return op["index"]
    if op.get("at_end"):
        end_index = get_doc_end_index(document)
        return max(1, end_index - 1)

    match = op.get("match")
    if match:
        matches = ranges_from_match(text, index_map, match, match_all=False)
        if not matches:
            raise ValueError("Match text not found for insert_text")
        if op.get("position") == "before":
            return matches[0]["startIndex"]
        return matches[0]["endIndex"]

    raise ValueError("insert_text requires index, at_end, or match")


def text_style_fields(style):
    fields = []
    if "bold" in style:
        fields.append("bold")
    if "italic" in style:
        fields.append("italic")
    if "underline" in style:
        fields.append("underline")
    if "font_family" in style:
        fields.append("weightedFontFamily")
    if "font_size_pt" in style:
        fields.append("fontSize")
    if "color_rgb" in style:
        fields.append("foregroundColor")
    if "background_color_rgb" in style:
        fields.append("backgroundColor")
    return ",".join(fields)


def build_text_style(op):
    style = {}
    if "bold" in op:
        style["bold"] = bool(op["bold"])
    if "italic" in op:
        style["italic"] = bool(op["italic"])
    if "underline" in op:
        style["underline"] = bool(op["underline"])
    if "font_family" in op:
        style["weightedFontFamily"] = {"fontFamily": op["font_family"]}
    if "font_size_pt" in op:
        style["fontSize"] = {"magnitude": float(op["font_size_pt"]), "unit": "PT"}
    if "color_rgb" in op:
        r, g, b = op["color_rgb"]
        style["foregroundColor"] = {
            "color": {
                "rgbColor": {
                    "red": r / 255.0,
                    "green": g / 255.0,
                    "blue": b / 255.0,
                }
            }
        }
    if "background_color_rgb" in op:
        r, g, b = op["background_color_rgb"]
        style["backgroundColor"] = {
            "color": {
                "rgbColor": {
                    "red": r / 255.0,
                    "green": g / 255.0,
                    "blue": b / 255.0,
                }
            }
        }
    return style


def paragraph_style_fields(style):
    fields = []
    if "named_style_type" in style:
        fields.append("namedStyleType")
    if "alignment" in style:
        fields.append("alignment")
    if "line_spacing" in style:
        fields.append("lineSpacing")
    return ",".join(fields)


def build_paragraph_style(op):
    style = {}
    if "named_style_type" in op:
        style["namedStyleType"] = op["named_style_type"]
    if "alignment" in op:
        style["alignment"] = op["alignment"]
    if "line_spacing" in op:
        style["lineSpacing"] = float(op["line_spacing"])
    return style


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        doc_id = input_data.get("doc_id")
        operations = input_data.get("operations", [])
        if not doc_id:
            print(json.dumps({"status": "error", "message": "Missing 'doc_id' parameter"}))
            sys.exit(1)
        if not isinstance(operations, list) or not operations:
            print(json.dumps({"status": "error", "message": "Missing 'operations' list"}))
            sys.exit(1)

        access_token = get_access_token()
        document = docs_get(access_token, doc_id)
        text, index_map = extract_text_with_indices(document)

        requests = []
        for op in operations:
            op_type = op.get("type")
            if op_type == "replace_text":
                find_text = op.get("find")
                replace_text = op.get("replace", "")
                if not find_text:
                    raise ValueError("replace_text requires 'find'")
                requests.append({
                    "replaceAllText": {
                        "containsText": {
                            "text": find_text,
                            "matchCase": bool(op.get("match_case", False)),
                        },
                        "replaceText": replace_text,
                    }
                })
            elif op_type == "insert_text":
                insert_text = op.get("text", "")
                if insert_text == "":
                    raise ValueError("insert_text requires 'text'")
                index = resolve_insert_index(op, document, text, index_map)
                requests.append({
                    "insertText": {
                        "location": {"index": index},
                        "text": insert_text,
                    }
                })
            elif op_type == "style_text":
                style = build_text_style(op)
                fields = text_style_fields(op)
                if not fields:
                    raise ValueError("style_text requires at least one style field")
                ranges = resolve_ranges(op, document, text, index_map)
                for r in ranges:
                    requests.append({
                        "updateTextStyle": {
                            "range": r,
                            "textStyle": style,
                            "fields": fields,
                        }
                    })
            elif op_type == "paragraph_style":
                style = build_paragraph_style(op)
                fields = paragraph_style_fields(op)
                if not fields:
                    raise ValueError("paragraph_style requires at least one style field")
                ranges = resolve_ranges(op, document, text, index_map)
                for r in ranges:
                    requests.append({
                        "updateParagraphStyle": {
                            "range": r,
                            "paragraphStyle": style,
                            "fields": fields,
                        }
                    })
            elif op_type == "bullets":
                preset = op.get("preset", "BULLET_DISC_CIRCLE_SQUARE")
                ranges = resolve_ranges(op, document, text, index_map)
                for r in ranges:
                    requests.append({
                        "createParagraphBullets": {
                            "range": r,
                            "bulletPreset": preset,
                        }
                    })
            else:
                raise ValueError(f"Unsupported operation type: {op_type}")

        result = docs_request(access_token, f"/documents/{doc_id}:batchUpdate", {"requests": requests})
        print(json.dumps({
            "status": "success",
            "requests": len(requests),
            "result": result,
        }))

    except json.JSONDecodeError as exc:
        print(json.dumps({"status": "error", "message": f"Invalid JSON input: {exc}"}))
        sys.exit(1)
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
