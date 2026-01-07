#!/usr/bin/env python3
"""
Google OAuth2 Token Generator

Run this script, login in the browser, and get a fresh refresh token.

Usage:
    python scripts/google-oauth.py

Requires these env vars (or will prompt):
    - GOOGLE_DRIVE_CLIENT_ID
    - GOOGLE_DRIVE_CLIENT_SECRET
"""

import http.server
import json
import os
import sys
import urllib.parse
import urllib.request
import webbrowser
from threading import Thread

# OAuth endpoints
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REDIRECT_URI = "http://localhost:8080"

# Scopes for Drive and Gmail
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]

# Global to store the auth code
auth_code = None
server_done = False


class OAuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code, server_done

        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path in ["/", "/callback", ""]:
            if "code" in params:
                auth_code = params["code"][0]
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"""
                    <html>
                    <body style="font-family: system-ui; text-align: center; padding: 50px;">
                        <h1>Success!</h1>
                        <p>Authorization complete. You can close this window.</p>
                        <p>Return to the terminal to see your refresh token.</p>
                    </body>
                    </html>
                """)
            elif "error" in params:
                self.send_response(400)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                error = params.get("error", ["unknown"])[0]
                self.wfile.write(f"<h1>Error: {error}</h1>".encode())
            server_done = True
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress server logs


def get_env_or_prompt(name, hidden=False):
    """Get env var or prompt user."""
    value = os.environ.get(name)
    if value:
        return value

    prompt = f"Enter {name}: "
    if hidden:
        import getpass
        return getpass.getpass(prompt)
    return input(prompt)


def exchange_code_for_tokens(client_id, client_secret, code):
    """Exchange authorization code for tokens."""
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"\nError exchanging code: {e.code}")
        print(error_body)
        sys.exit(1)


def main():
    global auth_code, server_done

    print("=" * 60)
    print("Google OAuth2 Token Generator")
    print("=" * 60)
    print()

    # Load .env if present
    env_path = os.path.join(os.path.dirname(__file__), "..", "tenants", "anden", ".env")
    if os.path.exists(env_path):
        print(f"Loading credentials from: {env_path}")
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    value = value.strip().strip('"').strip("'")
                    os.environ.setdefault(key, value)
        print()

    # Get credentials
    client_id = get_env_or_prompt("GOOGLE_DRIVE_CLIENT_ID")
    client_secret = get_env_or_prompt("GOOGLE_DRIVE_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("Error: Client ID and Secret are required")
        sys.exit(1)

    # Build auth URL
    auth_params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # Force consent to get refresh token
    })
    auth_url = f"{AUTH_URL}?{auth_params}"

    # Start local server
    server = http.server.HTTPServer(("localhost", 8080), OAuthHandler)
    server_thread = Thread(target=lambda: server.handle_request())
    server_thread.start()

    print("Opening browser for Google login...")
    print()
    print("If browser doesn't open, visit this URL:")
    print(auth_url)
    print()

    # Open browser
    webbrowser.open(auth_url)

    # Wait for callback
    print("Waiting for authorization...")
    server_thread.join(timeout=120)

    if not auth_code:
        print("\nTimeout or error - no authorization code received")
        sys.exit(1)

    print("Got authorization code, exchanging for tokens...")
    print()

    # Exchange code for tokens
    tokens = exchange_code_for_tokens(client_id, client_secret, auth_code)

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")

    if not refresh_token:
        print("Warning: No refresh token in response!")
        print("This can happen if you've already authorized this app.")
        print("Try revoking access at https://myaccount.google.com/permissions")
        print()
        print("Response:", json.dumps(tokens, indent=2))
        sys.exit(1)

    print("=" * 60)
    print("SUCCESS! Here's your new refresh token:")
    print("=" * 60)
    print()
    print(f"GOOGLE_DRIVE_REFRESH_TOKEN={refresh_token}")
    print()
    print("=" * 60)
    print()
    print("To update production, run:")
    print()
    print(f'''curl -X POST "https://proxystaff-production.up.railway.app/admin/tenants/anden/credentials" \\
  -H "Authorization: Bearer cornut" \\
  -H "Content-Type: application/json" \\
  -d '{{"credentials": {{"GOOGLE_DRIVE_REFRESH_TOKEN": "{refresh_token}"}}}}'
''')


if __name__ == "__main__":
    main()
