import json

import pytest

from backend.app.services.report_package_errors import ReportPackageError
from backend.app.services.trend_flow_scanner import (
    extract_trend_flow_cover_template,
    extract_trend_flow_metadata,
)


def test_extract_trend_flow_metadata_from_manifest(tmp_path):
    trend_root = tmp_path / 'miumiu-trend-flow'
    (trend_root / 'pages').mkdir(parents=True)
    (trend_root / 'assets').mkdir()

    (trend_root / 'pages' / 'report.html').write_text(
        '''
        <html>
          <head><title>Miu Miu 趋势流动：2025</title></head>
          <body>
            <p>连续四季的轮廓、材质与品牌语义在这一份趋势流动中被系统性地串联起来。</p>
            <template id="aimoda-trend-flow-cover" data-aimoda-cover>
              <section><img src="../assets/cover.jpg" alt="" /></section>
            </template>
          </body>
        </html>
        ''',
        encoding='utf-8',
    )
    (trend_root / 'assets' / 'cover.jpg').write_bytes(b'cover')
    (trend_root / 'manifest.json').write_text(
        json.dumps(
            {
                'specVersion': '2.0',
                'contentType': 'trend_flow',
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
    (trend_root / 'pages' / 'report.html').write_text(
        '''
        <html><body>
          <template id="aimoda-trend-flow-cover" data-aimoda-cover>
            <section><img src="../assets/cover.jpg" alt="" /></section>
          </template>
        </body></html>
        ''',
        encoding='utf-8',
    )
    (trend_root / 'assets' / 'cover.jpg').write_bytes(b'cover')
    (trend_root / 'manifest.json').write_text(
        json.dumps(
            {
                'specVersion': '2.0',
                'contentType': 'trend_flow',
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


def test_extract_trend_flow_cover_template_from_entry_html(tmp_path):
    trend_root = tmp_path / 'miumiu-trend-flow'
    (trend_root / 'pages').mkdir(parents=True)
    entry_path = trend_root / 'pages' / 'report.html'
    entry_path.write_text(
        '''
        <html>
          <body>
            <main>完整报告正文</main>
            <template id="aimoda-trend-flow-cover" data-aimoda-cover>
              <section class="cover" onclick="alert('x')">
                <h1>Miu Miu Cover</h1>
                <img src="../assets/cover.jpg" alt="" />
                <script>alert('unsafe')</script>
              </section>
            </template>
          </body>
        </html>
        ''',
        encoding='utf-8',
    )

    cover = extract_trend_flow_cover_template(entry_path, trend_root)

    assert cover is not None
    assert cover.asset_path == 'pages/report.html'
    assert 'Miu Miu Cover' in cover.html
    assert '../assets/cover.jpg' in cover.html
    assert 'onclick=' not in cover.html
    assert '<script' not in cover.html


def test_extract_trend_flow_cover_fragment_from_rendered_content(tmp_path):
    trend_root = tmp_path / 'miumiu-trend-flow'
    (trend_root / 'pages').mkdir(parents=True)
    entry_path = trend_root / 'pages' / 'report.html'
    entry_path.write_text(
        '''
        <html>
          <head>
            <link rel="stylesheet" href="../assets/report.css">
            <style>.cover-c { color: #111; }</style>
          </head>
          <body>
            <section>A</section>
            <section>B</section>
            <section class="cover-c" data-aimoda-cover-fragment>
              <style>.inner-cover > h2 { color: #111; }</style>
              <h2>C 区块</h2>
              <img src="../assets/c.jpg" alt="">
            </section>
            <section>D</section>
          </body>
        </html>
        ''',
        encoding='utf-8',
    )

    cover = extract_trend_flow_cover_template(entry_path, trend_root)

    assert cover is not None
    assert cover.source == 'entry_fragment'
    assert cover.asset_path == 'pages/report.html'
    assert '<link rel="stylesheet" href="../assets/report.css">' in cover.html
    assert '<style>.cover-c { color: #111; }</style>' in cover.html
    assert '<style>.inner-cover > h2 { color: #111; }</style>' in cover.html
    assert 'data-aimoda-cover-fragment' in cover.html
    assert 'C 区块' in cover.html
    assert '../assets/c.jpg' in cover.html
    assert '<section>A</section>' not in cover.html
    assert '<section>D</section>' not in cover.html


def test_trend_flow_requires_cover_marker_for_upload(tmp_path):
    trend_root = tmp_path / 'missing-cover-template'
    (trend_root / 'pages').mkdir(parents=True)
    (trend_root / 'assets').mkdir()
    (trend_root / 'pages' / 'report.html').write_text(
        '<html><body><p>正文里即使有图片也不能代替标准 cover template。</p><img src="../assets/cover.jpg" /></body></html>',
        encoding='utf-8',
    )
    (trend_root / 'assets' / 'cover.jpg').write_bytes(b'cover')
    (trend_root / 'manifest.json').write_text(
        json.dumps(
            {
                'specVersion': '2.0',
                'contentType': 'trend_flow',
                'slug': 'missing-cover-template',
                'title': 'Missing Cover Template',
                'brand': 'Brand',
                'entryHtml': 'pages/report.html',
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

    with pytest.raises(ReportPackageError) as exc:
        extract_trend_flow_metadata(trend_root)

    assert exc.value.code == 'trend_flow_cover_marker_missing'
