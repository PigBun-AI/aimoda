REPORT_SPEC = {
    "version": "2.1.0",
    "updatedAt": "2026-04-06",
    "description": "AiModa Fashion Report Zip 规范 - 以 manifest + entryHtml + 相对路径资源为核心",
    "folderStructure": {
        "root": "{report-root}/",
        "required": ["manifest.json", "entry HTML", "zip-internal assets"],
        "optional": ["additional html pages", "assets/", "images/", "features file", "legacy cover image"],
        "recommendedLayout": {
            "manifest": "manifest.json",
            "pagesDir": "pages/",
            "assetsDir": "assets/",
        },
    },
    "manifest": {
        "requiredFields": ["slug", "brand", "season", "year", "entryHtml"],
        "recommendedFields": ["title", "reportType", "pages", "featuresFile", "lookCount", "version"],
        "optionalFields": ["overviewHtml", "coverImage"],
        "example": {
            "specVersion": "2.1",
            "reportType": "fashion_week_brief",
            "slug": "murmur-aw-2026-27-v5-2",
            "title": "Murmur 2026-27 秋冬 时装周快报",
            "brand": "Murmur",
            "season": "AW",
            "year": 2026,
            "entryHtml": "pages/report.html",
            "pages": ["pages/report.html", "pages/data.html"],
            "overviewHtml": None,
            "coverImage": None,
            "featuresFile": "image-features.json",
            "lookCount": 38,
        },
    },
    "htmlRules": {
        "entryHtml": "必须存在，平台默认展示该 HTML 作为 iframe 入口",
        "additionalHtml": "可存在任意数量，平台不再要求 overview.html 固定命名",
        "relativeLinksOnly": "HTML/CSS/JS 中的本地资源和页面跳转必须使用 ZIP 内部相对路径",
        "localFileReferences": "禁止使用 file://、绝对磁盘路径、ZIP 外路径、根绝对路径",
    },
    "assetRules": {
        "assetDirectories": ["assets/", "images/"],
        "formats": [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".json", ".css", ".js"],
        "inlineImages": "正文图片不得以大体积 data URI/base64 内嵌到 HTML；仅允许极小图标级别内嵌",
        "coverImage": "manifest.coverImage 现在可选；未提供时平台会自动使用 entryHtml 中第一张本地图片作为列表封面",
    },
    "uploadBehavior": {
        "preserveRelativePaths": True,
        "entryUrlSource": "manifest.entryHtml",
        "overviewOptional": True,
        "coverStrategy": "manifest.coverImage > legacy cover.jpg > entryHtml first local image",
        "legacyFallback": "兼容旧格式：无 manifest.json 时，要求根目录提供 index.html；cover.jpg 改为可选",
    },
}


OPENCLAW_UPLOAD_CONTRACT = {
    "version": "1.0.0",
    "updatedAt": "2026-04-06",
    "goal": "让 OpenClaw 以最少上下文稳定打包并上传 Fashion Report ZIP。",
    "requiredManifestFields": ["slug", "brand", "season", "year", "entryHtml"],
    "recommendedManifestFields": ["title", "reportType", "pages", "featuresFile", "lookCount", "version"],
    "optionalManifestFields": ["overviewHtml", "coverImage"],
    "hardFailures": [
        {"code": "missing_manifest_field", "when": "manifest 缺少必填字段"},
        {"code": "entry_html_not_found", "when": "manifest.entryHtml 不存在"},
        {"code": "linked_file_not_found", "when": "HTML 或 manifest 引用的 ZIP 内文件不存在"},
        {"code": "absolute_local_path_not_allowed", "when": "HTML 使用 file://、绝对路径或根绝对路径"},
        {"code": "path_traversal_not_allowed", "when": "文件路径尝试跳出 ZIP 根目录"},
        {"code": "inline_image_too_large", "when": "HTML 中存在过大的 base64 正文图片"},
        {"code": "cover_image_not_found", "when": "未显式提供封面且 entryHtml 首屏没有本地图片可做封面"},
    ],
    "serverAutofixes": [
        "单根目录 ZIP 自动下钻",
        "封面自动回退到 entryHtml 第一张本地图片",
        "pages/ 下 HTML 对根级 assets/ 的错误相对路径自动改写",
    ],
    "workflow": [
        "get_openclaw_upload_contract",
        "prepare_report_upload",
        "upload zip to signed OSS url",
        "complete_report_upload",
        "get_report_upload_status until completed",
    ],
    "toolPolicy": {
        "alwaysCallContractFirst": True,
        "neverUseLegacyUpload": True,
        "neverInlineLargeImages": True,
        "alwaysFollowNextAction": True,
    },
    "successDefinition": {
        "jobStatus": "completed",
        "reportFields": ["report_id", "report_slug"],
    },
}


OPENCLAW_REPORT_TEMPLATE = {
    "version": "1.0.0",
    "updatedAt": "2026-04-06",
    "folderTemplate": {
        "root": "{slug}-report/",
        "children": [
            "manifest.json",
            "pages/report.html",
            "assets/look-001.jpg",
            "assets/look-002.jpg",
        ],
    },
    "manifestTemplate": {
        "specVersion": "2.1",
        "reportType": "fashion_week_brief",
        "slug": "brand-aw-2026-sample",
        "title": "Brand 2026 秋冬 时装周快报",
        "brand": "Brand",
        "season": "AW",
        "year": 2026,
        "entryHtml": "pages/report.html",
        "pages": ["pages/report.html"],
        "coverImage": None,
    },
    "notes": [
        "如果不写 coverImage，平台会自动用 report.html 第一张本地图片做封面。",
        "overview.html 已不再必需。",
        "所有图片尽量拆到 assets/，不要把正文大图 base64 内嵌进 HTML。",
    ],
}


TREND_FLOW_SPEC = {
    "version": "2.0.0",
    "updatedAt": "2026-04-27",
    "description": "AiModa Trend Flow ZIP 规范 - 单品牌、连续四个季度的趋势流动报告",
    "folderStructure": {
        "root": "{trend-flow-root}/",
        "required": ["manifest.json", "entry HTML", "zip-internal assets"],
        "optional": ["additional html pages", "assets/", "images/"],
    },
    "manifest": {
        "requiredFields": ["specVersion", "contentType", "slug", "title", "brand", "timeline", "entryHtml"],
        "strictRules": {
            "specVersion": "必须存在，推荐使用 2.0",
            "contentType": "必须严格等于 trend_flow",
            "title": "必须显式提供，不再依赖 entryHtml <title> 推断作为合格上传标准",
        },
        "timelineRules": {
            "exactLength": 4,
            "requiredFields": ["quarter", "year"],
            "quarterValues": ["早春", "春夏", "早秋", "秋冬"],
            "mustBeConsecutive": True,
        },
        "example": {
            "specVersion": "2.0",
            "contentType": "trend_flow",
            "slug": "miumiu-2025-early-spring-to-aw-trend-flow",
            "title": "Miu Miu 趋势流动：2025 早春至秋冬",
            "brand": "Miu Miu",
            "timeline": [
                {"quarter": "早春", "year": 2025},
                {"quarter": "春夏", "year": 2025},
                {"quarter": "早秋", "year": 2025},
                {"quarter": "秋冬", "year": 2025},
            ],
            "entryHtml": "pages/report.html",
            "overviewHtml": None,
            "coverImage": None,
        },
    },
    "coverFragment": {
        "goal": "让内部 Agent 在完整 HTML 报告中声明一个不参与正文渲染的封面片段，平台会解析该片段用于趋势流动滚动页封面预览。",
        "acceptedMarkers": [
            '<template id="aimoda-trend-flow-cover" data-aimoda-cover>...</template>',
            '<section data-aimoda-cover-fragment>...</section>',
        ],
        "required": True,
        "placement": "必须放在 manifest.entryHtml 指向的 HTML 文件中，且只能出现一次。template 适合单独设计封面；data-aimoda-cover-fragment 适合直接标记正文里现成的 C 区块。",
        "resourceRule": "片段内图片、CSS 背景图等资源必须继续使用 ZIP 内部相对路径；平台会按 entryHtml 所在目录解析并重写为可访问预览资源。",
        "styleRule": "使用 data-aimoda-cover-fragment 标记正文区块时，平台会一并抽取 entryHtml 内的 <style> 与 stylesheet <link> 到封面 iframe；仍建议该区块不要依赖正文脚本。",
        "fallback": "仅历史数据展示层保留 manifest.coverImage / legacy cover.* / entryHtml 第一张本地图片 / 完整报告预览回退；新 MCP 上传缺少封面标记会直接失败。",
        "templateExample": """
<template id="aimoda-trend-flow-cover" data-aimoda-cover>
  <section class="tf-cover">
    <p class="tf-kicker">MIU MIU · FOUR-SEASON FLOW</p>
    <h1>Miu Miu 趋势流动：2025 早春至秋冬</h1>
    <img src="../assets/cover-hero.jpg" alt="" />
  </section>
</template>
""".strip(),
        "fragmentExample": """
<main>
  <section>A</section>
  <section>B</section>
  <section data-aimoda-cover-fragment>
    <p class="tf-kicker">MIU MIU · KEY TRANSITION</p>
    <h2>C 区块：这一季真正要作为趋势流动封面的内容</h2>
    <img src="../assets/key-transition.jpg" alt="" />
  </section>
  <section>D</section>
</main>
""".strip(),
    },
    "htmlRules": {
        "coverTemplateNonRendering": "如果封面是单独设计的内容，使用 template 标记，浏览器不会在完整报告正文中渲染。",
        "coverFragmentFromContent": "如果封面就是正文中的 C 区块，直接在该区块根节点添加 data-aimoda-cover-fragment；该区块仍会在完整报告中正常渲染。",
        "coverFragmentScope": "封面片段只负责列表滚动页第一视觉，不要依赖正文页全局脚本；允许写片段内 style，禁止把大图 base64 内嵌。",
        "entryHtml": "完整报告阅读仍以 manifest.entryHtml 为准；封面标记只是平台额外解析的展示片段。",
    },
    "strictUploadPolicy": {
        "missingCoverMarker": "hard_fail",
        "duplicateCoverMarker": "hard_fail",
        "emptyCoverMarker": "hard_fail",
        "missingSpecVersion": "hard_fail",
        "missingContentType": "hard_fail",
        "invalidContentType": "hard_fail",
        "legacyCoverFallback": "仅用于历史数据展示，不作为新 MCP 上传包的合格标准",
    },
    "compiledArtifact": {
        "description": "后端会把自由 HTML ZIP 编译为稳定中间产物；数据库和前端只消费该产物字段，不直接推断上传包结构。",
        "fields": [
            "contract",
            "entryHtml",
            "overviewHtml",
            "coverImage",
            "coverHtml",
            "coverHtmlAssetPath",
            "coverHtmlSource",
            "timeline",
            "lead_excerpt",
        ],
        "contract": {
            "type": "trend_flow_package",
            "version": "2.0.0",
            "strict": True,
        },
    },
}


TREND_FLOW_TEMPLATE = {
    "version": "2.0.0",
    "updatedAt": "2026-04-27",
    "folderTemplate": {
        "root": "{slug}-trend-flow/",
        "children": [
            "manifest.json",
            "pages/report.html",
            "assets/cover.jpg",
            "assets/chart-01.jpg",
        ],
    },
    "manifestTemplate": {
        "specVersion": "2.0",
        "contentType": "trend_flow",
        "slug": "brand-2025-trend-flow",
        "title": "Brand 趋势流动：2025 早春至秋冬",
        "brand": "Brand",
        "timeline": [
            {"quarter": "早春", "year": 2025},
            {"quarter": "春夏", "year": 2025},
            {"quarter": "早秋", "year": 2025},
            {"quarter": "秋冬", "year": 2025},
        ],
        "entryHtml": "pages/report.html",
        "coverImage": None,
    },
    "entryHtmlCoverSnippet": """
<template id="aimoda-trend-flow-cover" data-aimoda-cover>
  <style>
    .tf-cover {
      min-height: 100%;
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(280px, 1.1fr);
      gap: 32px;
      align-items: end;
      padding: clamp(28px, 5vw, 64px);
      background: #f5f0e8;
      color: #171512;
      font-family: Georgia, "Times New Roman", serif;
    }
    .tf-cover h1 {
      margin: 0;
      max-width: 10ch;
      font-size: clamp(48px, 8vw, 112px);
      line-height: 0.9;
      letter-spacing: -0.06em;
    }
    .tf-cover img {
      width: 100%;
      height: min(68vh, 680px);
      object-fit: cover;
      border: 1px solid rgba(23, 21, 18, 0.22);
    }
    .tf-kicker {
      margin: 0 0 18px;
      font: 600 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
  </style>
  <section class="tf-cover">
    <div>
      <p class="tf-kicker">BRAND · FOUR-SEASON FLOW</p>
      <h1>Brand 趋势流动：2025 早春至秋冬</h1>
    </div>
    <img src="../assets/cover.jpg" alt="" />
  </section>
</template>
""".strip(),
    "notes": [
        "如果封面需要独立设计，使用 template id=\"aimoda-trend-flow-cover\" data-aimoda-cover。",
        "如果封面就是正文里的某个现成区块，直接在该区块根节点添加 data-aimoda-cover-fragment。",
        "片段内资源路径按 entryHtml 所在目录解析，例如 pages/report.html 中引用 ../assets/cover.jpg。",
    ],
}
