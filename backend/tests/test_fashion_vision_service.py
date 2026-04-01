from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent import tools
from app.services import fashion_vision_service as service


class _FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": """```json
{
  \"images\": [{\"summary_zh\": \"黑色修身外套\", \"visible_garments\": [\"jacket\"], \"dominant_colors\": [\"black\"], \"confidence\": 0.91}],
  \"merged_understanding\": {
    \"summary_zh\": \"一套极简黑色造型\",
    \"retrieval_query_en\": \"minimal black tailored jacket look\",
    \"style_keywords\": [\"minimal\", \"tailored\"],
    \"hard_filters\": {\"category\": [\"jacket\"], \"color\": [\"black\"], \"fabric\": [], \"gender\": \"womenswear\", \"season\": [\"fall\"]}
  }
}
```"""
                    }
                }
            ]
        }


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return _FakeResponse()


def test_load_fashion_vision_prompt_contains_contract():
    prompt = service.load_fashion_vision_prompt()
    assert "Output JSON only" in prompt
    assert "retrieval_query_en" in prompt


async def _run_analysis():
    return await service.analyze_fashion_images(
        [{"type": "image", "source": {"type": "url", "url": "https://example.com/look.jpg"}}],
        user_request="用于检索",
    )


def test_analyze_fashion_images_normalizes_response(monkeypatch):
    monkeypatch.setattr(service.settings, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(service.settings, "OPENAI_BASE_URL", "https://example.com/v1")
    monkeypatch.setattr(service.settings, "VLM_MODEL", "test-vlm")
    monkeypatch.setattr(service.settings, "VLM_TIMEOUT_SECONDS", 5.0)
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    import asyncio

    result = asyncio.run(_run_analysis())

    assert result["merged_understanding"]["retrieval_query_en"] == "minimal black tailored jacket look"
    assert result["merged_understanding"]["hard_filters"]["category"] == ["jacket"]
    assert result["images"][0]["visible_garments"] == ["jacket"]
    assert result["model"] == "test-vlm"


def test_fashion_vision_tool_uses_session_images(monkeypatch):
    config = {"configurable": {"thread_id": "user-1:session-1"}}

    monkeypatch.setattr(tools, "get_session_image_blocks", lambda thread_id: [
        {"type": "image", "source": {"type": "url", "url": "https://example.com/look.jpg"}}
    ])
    def _fake_run_coro_sync(coro):
        coro.close()
        return {
            "model": "test-vlm",
            "merged_understanding": {
                "summary_zh": "黑色西装外套",
                "retrieval_query_en": "black tailored blazer",
                "style_keywords": ["minimal"],
                "hard_filters": {"category": ["jacket"], "color": ["black"], "fabric": [], "gender": "", "season": []},
                "follow_up_questions_zh": [],
            },
        }

    monkeypatch.setattr(tools, "_run_coro_sync", _fake_run_coro_sync)
    monkeypatch.setattr(tools, "create_artifact", lambda **kwargs: {"id": "artifact-1"})

    result = tools.fashion_vision.func("找类似款", config=config)

    import json

    payload = json.loads(result)
    assert payload["ok"] is True
    assert payload["artifact_id"] == "artifact-1"
    assert payload["analysis"]["retrieval_query_en"] == "black tailored blazer"
    assert payload["analysis"]["hard_filters"]["category"] == ["jacket"]
