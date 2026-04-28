import json

from backend.app.services.trend_flow_package_compiler import compile_trend_flow_package


def test_compile_trend_flow_package_returns_stable_artifact(tmp_path):
    trend_root = tmp_path / "brand-trend-flow"
    (trend_root / "pages").mkdir(parents=True)
    (trend_root / "assets").mkdir()
    (trend_root / "pages" / "report.html").write_text(
        """
        <html>
          <head><style>.cover { color: #111; }</style></head>
          <body>
            <template id="aimoda-trend-flow-cover" data-aimoda-cover>
              <section class="cover" data-aimoda-cover="trend-flow" data-cover-ratio="16:9" data-cover-width="1600" data-cover-height="900">
                <h2>核心封面区块</h2>
                <img src="../assets/cover.jpg" alt="" />
              </section>
            </template>
            <p>连续四季的轮廓、材质与品牌语义在这一份趋势流动中被系统性地串联起来。</p>
          </body>
        </html>
        """,
        encoding="utf-8",
    )
    (trend_root / "assets" / "cover.jpg").write_bytes(b"cover")
    (trend_root / "manifest.json").write_text(
        json.dumps(
            {
                "specVersion": "3.0",
                "contentType": "trend_flow",
                "slug": "brand-2025-trend-flow",
                "title": "Brand 趋势流动：2025",
                "brand": "Brand",
                "entryHtml": "pages/report.html",
                "timeline": [
                    {"quarter": "早春", "year": 2025},
                    {"quarter": "春夏", "year": 2025},
                    {"quarter": "早秋", "year": 2025},
                    {"quarter": "秋冬", "year": 2025},
                ],
            }
        ),
        encoding="utf-8",
    )

    artifact = compile_trend_flow_package(trend_root)
    payload = artifact.metadata_payload()

    assert artifact.slug == "brand-2025-trend-flow"
    assert artifact.entry_html == "pages/report.html"
    assert artifact.cover_image == "assets/cover.jpg"
    assert artifact.cover_html_source == "entry_template"
    assert payload["contract"] == {
        "type": "trend_flow_package",
        "version": "3.0.0",
        "strict": True,
    }
    assert payload["coverHtmlAssetPath"] == "pages/report.html"
    assert payload["timeline"][0] == {"quarter": "早春", "year": 2025}
