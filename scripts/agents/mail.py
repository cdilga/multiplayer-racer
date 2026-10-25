#!/usr/bin/env python3
"""Call the running Agent Mail MCP server without opening its database.

Usage: python3 scripts/agents/mail.py TOOL [JSON | @FILE]
Omit JSON to read it from stdin. Credentials stay in the existing local MCP config.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def config():
    # Claude's local HTTP config is also the shared transport for Codex and OMP.
    for path in (ROOT / ".mcp.json", ROOT / ".claude/settings.local.json"):
        if path.exists():
            entry = json.loads(path.read_text()).get("mcpServers", {}).get("mcp-agent-mail", {})
            if entry.get("url"):
                return entry
    raise RuntimeError("Configure the running Agent Mail HTTP server in .mcp.json or .claude/settings.local.json")


def call(name, arguments):
    entry = config()
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    headers.update(entry.get("headers", {}))
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": name, "arguments": arguments}}
    request = urllib.request.Request(entry["url"], json.dumps(payload).encode(), headers)
    # Never print requests, headers, or server exception bodies: they can contain credentials.
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Agent Mail HTTP {error.code}; check the local MCP connection") from None
    except urllib.error.URLError:
        raise RuntimeError("Agent Mail HTTP server unavailable; start it before launching a session") from None
    if raw.lstrip().startswith("{"):
        envelope = json.loads(raw)
    else:
        events = [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith("data:")]
        envelope = next((event for event in events if event.get("id") == 1), {})
    if envelope.get("error") or "result" not in envelope:
        raise RuntimeError("Agent Mail rejected the MCP request")
    result = envelope["result"]
    if result.get("isError"):
        raise RuntimeError("Agent Mail tool failed; inspect the server locally")
    blocks = [part["text"] for part in result.get("content", []) if part.get("type") == "text"]
    if len(blocks) == 1:
        try:
            return json.loads(blocks[0])
        except ValueError:
            return blocks[0]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tool")
    parser.add_argument("arguments", nargs="?")
    args = parser.parse_args()
    raw = args.arguments
    if raw is None:
        raw = sys.stdin.read()
    elif raw.startswith("@"):
        raw = Path(raw[1:]).read_text()
    result = call(args.tool, json.loads(raw))
    # Registration tokens are optional for subsequent calls and must not enter transcripts.
    if isinstance(result, dict):
        result.pop("registration_token", None)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        sys.exit(f"mail: {error}")
