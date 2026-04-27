import pytest

from backend.app.config import settings
from backend.app.dependencies import require_trend_flow_mcp_internal_service
from backend.app.exceptions import AppError
from backend.app.models import TrendFlowRecord, TrendFlowUploadJobRecord
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


def _upload_job(job_id: str = 'job-1', status: str = 'pending') -> TrendFlowUploadJobRecord:
    return TrendFlowUploadJobRecord(
        id=job_id,
        filename='trend-flow.zip',
        status=status,
        uploaded_by=88,
        file_size_bytes=123,
        source_object_key=f'trend-flow-uploads/{job_id}/trend-flow.zip',
        trend_flow_id=None,
        trend_flow_slug=None,
        error_message=None,
        created_at='2026-04-23T00:00:00Z',
        updated_at='2026-04-23T00:00:00Z',
        started_at=None,
        completed_at=None,
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


def test_prepare_trend_flow_upload_for_mcp_returns_signed_target(monkeypatch):
    monkeypatch.setattr(settings, 'TREND_FLOW_MCP_SERVICE_USER_ID', 88)
    monkeypatch.setattr(
        trend_flow_mcp_internal,
        'prepare_direct_trend_flow_upload_job',
        lambda **kwargs: {
            'job': _upload_job(),
            'upload': {
                'method': 'PUT',
                'url': 'https://oss.example.com/trend-flow-uploads/job-1/trend-flow.zip?signature=abc',
                'headers': {'Content-Type': 'application/zip'},
                'object_key': 'trend-flow-uploads/job-1/trend-flow.zip',
                'content_type': 'application/zip',
                'expires_at': '2026-04-23T00:10:00Z',
            },
        },
    )

    response = trend_flow_mcp_internal.prepare_trend_flow_upload_for_mcp(
        body=trend_flow_mcp_internal.PrepareTrendFlowUploadRequest(filename='trend-flow.zip', file_size_bytes=123),
        service_name='trend-flow-mcp',
    )

    assert response['success'] is True
    assert response['upload']['method'] == 'PUT'
    assert response['upload']['objectKey'] == 'trend-flow-uploads/job-1/trend-flow.zip'
    assert response['next_action']['type'] == 'upload_zip_to_oss'


def test_complete_trend_flow_upload_for_mcp_returns_processing_job(monkeypatch):
    monkeypatch.setattr(trend_flow_mcp_internal, 'get_trend_flow_upload_job', lambda job_id: _upload_job(job_id=job_id))
    monkeypatch.setattr(settings, 'TREND_FLOW_MCP_SERVICE_USER_ID', 88)
    monkeypatch.setattr(
        trend_flow_mcp_internal,
        'complete_direct_trend_flow_upload_job',
        lambda job_id, uploaded_by: _upload_job(job_id=job_id, status='processing'),
    )

    response = trend_flow_mcp_internal.complete_trend_flow_upload_for_mcp(
        body=trend_flow_mcp_internal.CompleteTrendFlowUploadRequest(
            job_id='job-1',
            object_key='trend-flow-uploads/job-1/trend-flow.zip',
        ),
        service_name='trend-flow-mcp',
    )

    assert response['success'] is True
    assert response['job']['status'] == 'processing'
    assert response['next_action']['type'] == 'poll_trend_flow_upload_status'


def test_get_trend_flow_upload_job_for_mcp_returns_job(monkeypatch):
    monkeypatch.setattr(
        trend_flow_mcp_internal,
        'get_trend_flow_upload_job',
        lambda job_id: _upload_job(job_id=job_id, status='completed').model_copy(
            update={'trend_flow_id': 11, 'trend_flow_slug': 'miumiu-2025-trend-flow'}
        ),
    )

    response = trend_flow_mcp_internal.get_trend_flow_upload_job_for_mcp(
        job_id='job-1',
        service_name='trend-flow-mcp',
    )

    assert response['success'] is True
    assert response['job']['status'] == 'completed'
    assert response['job']['trendFlowSlug'] == 'miumiu-2025-trend-flow'
    assert response['next_action']['type'] == 'done'
