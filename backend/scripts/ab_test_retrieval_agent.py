"""
A/B smoke test for aimoda retrieval-agent stability.

Usage:
  python backend/scripts/ab_test_retrieval_agent.py --base-url https://dev.ai-moda.ai
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
import uuid


TEXT_CASES = [
    {"name": "dress_basic", "content": [{"type": "text", "text": "帮我找蓝色的连衣裙"}]},
    {"name": "dress_collar", "content": [{"type": "text", "text": "我想要找娃娃领的连衣裙"}]},
    {"name": "jacket_basic", "content": [{"type": "text", "text": "我在找黑色西装外套"}]},
]


def _post(base_url: str, path: str, payload: dict, token: str | None = None, timeout: int = 180) -> str:
    headers = {"Content-Type": "application/json", "User-Agent": "aimoda-ab-test/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        base_url + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _summarize_sse(raw: str) -> dict:
    return {
        "tool_use_blocks": raw.count('"block_type": "tool_use"'),
        "tool_result_blocks": raw.count('"block_type": "tool_result"'),
        "add_filter_calls": raw.count('"name": "add_filter"'),
        "tool_errors": raw.count('"error"'),
        "missing_category_errors": raw.count("For 'collar' filter, specify which garment category"),
        "show_collection_calls": raw.count('"name": "show_collection"'),
        "message_stop": raw.count('"type": "message_stop"'),
    }


def run_case(base_url: str, token: str, case: dict) -> dict:
    session = json.loads(_post(base_url, "/api/chat/sessions", {"title": case["name"]}, token=token))
    session_id = session["data"]["id"]
    raw = _post(
        base_url,
        "/api/chat",
        {"content": case["content"], "session_id": session_id, "history": []},
        token=token,
        timeout=240,
    )
    return {"name": case["name"], "metrics": _summarize_sse(raw)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()

    email = f"ab-{uuid.uuid4().hex[:8]}@example.com"
    password = "Passw0rd123!"
    reg = json.loads(_post(args.base_url, "/api/auth/register", {"email": email, "password": password}))
    token = reg["data"]["tokens"]["accessToken"]

    results = [run_case(args.base_url, token, case) for case in TEXT_CASES]
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
