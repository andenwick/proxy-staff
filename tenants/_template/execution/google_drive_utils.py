#!/usr/bin/env python3
"""
Shared helpers for Google Drive tools.

Required environment variables:
- GOOGLE_DRIVE_CLIENT_ID
- GOOGLE_DRIVE_CLIENT_SECRET
- GOOGLE_DRIVE_REFRESH_TOKEN
"""

import json
import os
import urllib.parse
import urllib.request
import urllib.error


def load_env_from_cwd():
    """Load .env file from current working directory into os.environ."""
    env_path = os.path.join(os.getcwd(), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    value = value.strip()
                    if (value.startswith('"') and value.endswith('"')) or \
                       (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                    os.environ[key] = value
        return True
    return False


# Load .env file on module import
load_env_from_cwd()

TOKEN_URL = os.environ.get("GOOGLE_DRIVE_TOKEN_URL", "https://oauth2.googleapis.com/token")
DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"
UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3"


def _required_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


def get_access_token():
    client_id = _required_env("GOOGLE_DRIVE_CLIENT_ID")
    client_secret = _required_env("GOOGLE_DRIVE_CLIENT_SECRET")
    refresh_token = _required_env("GOOGLE_DRIVE_REFRESH_TOKEN")

    payload = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode("utf-8")

    request = urllib.request.Request(TOKEN_URL, data=payload, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Token request failed: {exc.code} {body}")

    data = json.loads(body)
    access_token = data.get("access_token")
    if not access_token:
        raise RuntimeError(f"Token response missing access_token: {body}")

    return access_token


def drive_request(access_token, path, params=None, method="GET", data=None, headers=None, api_base=DRIVE_API_BASE):
    url = api_base + path
    if params:
        query = urllib.parse.urlencode(params, doseq=True)
        url = f"{url}?{query}"

    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {access_token}")

    if headers:
        for key, value in headers.items():
            request.add_header(key, value)

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Drive API request failed: {exc.code} {body}")


def drive_get_json(access_token, path, params=None, api_base=DRIVE_API_BASE):
    raw = drive_request(access_token, path, params=params, api_base=api_base)
    return json.loads(raw.decode("utf-8"))


def drive_json_request(access_token, path, params=None, method="POST", payload=None, api_base=DRIVE_API_BASE):
    data = None
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    raw = drive_request(
        access_token,
        path,
        params=params,
        method=method,
        data=data,
        headers=headers,
        api_base=api_base,
    )
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))
