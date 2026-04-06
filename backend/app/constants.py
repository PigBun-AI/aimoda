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
