import json

import pytest

from backend.app.services.report_package_errors import ReportPackageError
from backend.app.services.trend_flow_scanner import extract_trend_flow_metadata


def test_extract_trend_flow_metadata_from_manifest(tmp_path):
    trend_root = tmp_path / 'miumiu-trend-flow'
    (trend_root / 'pages').mkdir(parents=True)
    (trend_root / 'assets').mkdir()

    (trend_root / 'pages' / 'report.html').write_text(
        '<html><head><title>Miu Miu 趋势流动：2025</title></head><body><p>连续四季的轮廓、材质与品牌语义在这一份趋势流动中被系统性地串联起来。</p></body></html>',
        encoding='utf-8',
    )
    (trend_root / 'assets' / 'cover.jpg').write_bytes(b'cover')
    (trend_root / 'manifest.json').write_text(
        json.dumps(
            {
                'slug': 'miumiu-2025-trend-flow',
                'title': 'Miu Miu 趋势流动：2025',
                'brand': 'Miu Miu',
                'entryHtml': 'pages/report.html',
                'coverImage': 'assets/cover.jpg',
                'timeline': [
                    {'quarter': '早春', 'year': 2025},
                    {'quarter': '春夏', 'year': 2025},
                    {'quarter': '早秋', 'year': 2025},
                    {'quarter': '秋冬', 'year': 2025},
                ],
            }
        ),
        encoding='utf-8',
    )

    metadata = extract_trend_flow_metadata(trend_root)

    assert metadata.slug == 'miumiu-2025-trend-flow'
    assert metadata.brand == 'Miu Miu'
    assert [point.quarter for point in metadata.timeline] == ['早春', '春夏', '早秋', '秋冬']
    assert metadata.lead_excerpt == '连续四季的轮廓、材质与品牌语义在这一份趋势流动中被系统性地串联起来。'


def test_trend_flow_requires_consecutive_timeline(tmp_path):
    trend_root = tmp_path / 'broken-trend-flow'
    (trend_root / 'pages').mkdir(parents=True)
    (trend_root / 'assets').mkdir()
    (trend_root / 'pages' / 'report.html').write_text('<html><body></body></html>', encoding='utf-8')
    (trend_root / 'assets' / 'cover.jpg').write_bytes(b'cover')
    (trend_root / 'manifest.json').write_text(
        json.dumps(
            {
                'slug': 'broken-trend-flow',
                'title': 'Broken Trend Flow',
                'brand': 'Brand',
                'entryHtml': 'pages/report.html',
                'coverImage': 'assets/cover.jpg',
                'timeline': [
                    {'quarter': '早春', 'year': 2025},
                    {'quarter': '早秋', 'year': 2025},
                    {'quarter': '秋冬', 'year': 2025},
                    {'quarter': '早春', 'year': 2026},
                ],
            }
        ),
        encoding='utf-8',
    )

    with pytest.raises(ReportPackageError) as exc:
        extract_trend_flow_metadata(trend_root)

    assert exc.value.code == 'non_consecutive_timeline'
