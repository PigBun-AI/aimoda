import io

import pytest
from fastapi import UploadFile

from backend.app.config import settings
from backend.app.dependencies import require_trend_flow_mcp_internal_service
from backend.app.exceptions import AppError
from backend.app.models import TrendFlowRecord
from backend.app.routers import trend_flow_mcp_internal


def _trend_flow() -> TrendFlowRecord:
    return TrendFlowRecord(
        id=11,
        slug='miumiu-2025-trend-flow',
        title='Miu Miu 趋势流动：2025',
        brand='Miu Miu',
        start_quarter='早春',
        start_year=2025,
        end_quarter='秋冬',
        end_year=2025,
        index_url='https://oss.example.com/trend-flow/miumiu/pages/report.html',
        overview_url=None,
        cover_url='https://oss.example.com/trend-flow/miumiu/assets/cover.jpg',
        oss_prefix='trend-flow/miumiu-2025-trend-flow',
        uploaded_by=1,
        timeline_json='[{"quarter":"早春","year":2025}]',
        metadata_json='{"timeline":[{"quarter":"早春","year":2025}]}',
        lead_excerpt='连续四季的品牌演化。',
        created_at='2026-04-23T00:00:00Z',
        updated_at='2026-04-23T00:00:00Z',
    )


def test_require_trend_flow_mcp_internal_service_accepts_valid_token(monkeypatch):
    monkeypatch.setattr(settings, 'TREND_FLOW_MCP_INTERNAL_TOKEN', 'token-123')

    service_name = require_trend_flow_mcp_internal_service(
        x_internal_token='token-123',
        x_internal_service='trend-flow-mcp',
    )

    assert service_name == 'trend-flow-mcp'


def test_require_trend_flow_mcp_internal_service_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(settings, 'TREND_FLOW_MCP_INTERNAL_TOKEN', 'token-123')

    with pytest.raises(AppError) as exc:
        require_trend_flow_mcp_internal_service(
            x_internal_token='wrong-token',
            x_internal_service='trend-flow-mcp',
        )

    assert exc.value.status_code == 401


def test_list_trend_flows_for_mcp_returns_slug_payload(monkeypatch):
    monkeypatch.setattr(trend_flow_mcp_internal, 'find_trend_flow_by_slug', lambda slug: _trend_flow())

    response = trend_flow_mcp_internal.list_trend_flows_for_mcp(
        service_name='trend-flow-mcp',
        slug='miumiu-2025-trend-flow',
        page=1,
        limit=20,
    )

    assert response['success'] is True
    assert response['found'] is True
    assert response['trend_flow']['slug'] == 'miumiu-2025-trend-flow'
    assert response['trend_flow']['brand'] == 'Miu Miu'


@pytest.mark.asyncio
async def test_upload_trend_flow_for_mcp_uses_service_user_id(monkeypatch):
    captured = {}

    def _fake_upload_trend_flow_archive(*, archive_path: str, uploaded_by: int):
        captured['archive_path'] = archive_path
        captured['uploaded_by'] = uploaded_by
        return _trend_flow()

    monkeypatch.setattr(trend_flow_mcp_internal, 'upload_trend_flow_archive', _fake_upload_trend_flow_archive)
    monkeypatch.setattr(settings, 'TREND_FLOW_MCP_SERVICE_USER_ID', 88)

    upload = UploadFile(filename='trend-flow.zip', file=io.BytesIO(b'zip-content'))
    response = await trend_flow_mcp_internal.upload_trend_flow_for_mcp(
        service_name='trend-flow-mcp',
        file=upload,
    )

    assert response['success'] is True
    assert response['trend_flow']['slug'] == 'miumiu-2025-trend-flow'
    assert response['trend_flow']['startQuarter'] == '早春'
    assert captured['uploaded_by'] == 88
    assert captured['archive_path'].endswith('.zip')
