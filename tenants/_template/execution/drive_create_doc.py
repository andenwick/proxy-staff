#!/usr/bin/env python3
"""
Create a Google Doc in Drive (optional content import).

Required environment variables:
- GOOGLE_DRIVE_CLIENT_ID
- GOOGLE_DRIVE_CLIENT_SECRET
- GOOGLE_DRIVE_REFRESH_TOKEN
"""

import json
import sys
import uuid

from google_drive_utils import get_access_token, drive_json_request, drive_request, UPLOAD_API_BASE


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        title = input_data.get("title") or input_data.get("name")
        content = input_data.get("content")
        parent_id = input_data.get("parent_id")

        if not title:
            print(json.dumps({"status": "error", "message": "Missing 'title' parameter"}))
            sys.exit(1)

        metadata = {
            "name": title,
            "mimeType": "application/vnd.google-apps.document",
        }
        if parent_id:
            metadata["parents"] = [parent_id]

        access_token = get_access_token()

        if content:
            boundary = f"=============={uuid.uuid4().hex}=="
            delimiter = f"--{boundary}\r\n".encode("utf-8")
            close_delim = f"--{boundary}--\r\n".encode("utf-8")
            content_bytes = str(content).encode("utf-8")

            body = b"".join([
                delimiter,
                b"Content-Type: application/json; charset=utf-8\r\n\r\n",
                json.dumps(metadata).encode("utf-8"),
                b"\r\n",
                delimiter,
                b"Content-Type: text/plain; charset=utf-8\r\n\r\n",
                content_bytes,
                b"\r\n",
                close_delim,
            ])

            raw = drive_request(
                access_token,
                "/files",
                params={"uploadType": "multipart", "fields": "id,name,mimeType,webViewLink,parents"},
                method="POST",
                data=body,
                headers={"Content-Type": f"multipart/related; boundary={boundary}"},
                api_base=UPLOAD_API_BASE,
            )
            result = json.loads(raw.decode("utf-8"))
        else:
            result = drive_json_request(
                access_token,
                "/files",
                payload=metadata,
                method="POST",
            )

        print(json.dumps({
            "status": "success",
            "file": result,
        }))

    except json.JSONDecodeError as exc:
        print(json.dumps({"status": "error", "message": f"Invalid JSON input: {exc}"}))
        sys.exit(1)
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
