---
name: wwwd-reports
description: "Generate and upload AiModa fashion reports via MCP. Use when OpenClaw needs the latest report zip spec, needs to package HTML reports with relative-path assets, or needs to upload/verify published reports."
metadata:
  openclaw:
    emoji: "👗"
    requires:
      bins: ["zip"]
      packages: []
    mcp:
      server: "wwwd-reports"
      url: "https://ai-moda.ai/api/report-mcp"
---

# WWWD Reports

Use this skill when OpenClaw is preparing a report zip for AiModa / WWWD upload.

## First Rule

Always call `mcp__wwwd-reports__get_report_spec` before packaging a report.

## Current Zip Spec

The platform now uses **manifest + entryHtml + coverImage + relative-path assets**.

### Required

```text
{report-root}/
├── manifest.json
├── {entryHtml declared in manifest}
└── {coverImage declared in manifest}
```

### Recommended

```text
{report-root}/
├── manifest.json
├── pages/
│   ├── report.html
│   └── *.html
├── assets/
│   ├── cover.jpg
│   ├── look-001.jpg
│   └── ...
└── image-features.json
```

## Manifest Example

```json
{
  "specVersion": "2.0",
  "slug": "murmur-aw-2026-27-v5-2",
  "title": "Murmur 2026-27 秋冬 时装周快报",
  "brand": "Murmur",
  "season": "AW",
  "year": 2026,
  "entryHtml": "pages/report.html",
  "pages": ["pages/report.html"],
  "overviewHtml": null,
  "coverImage": "assets/cover.jpg",
  "featuresFile": "image-features.json",
  "lookCount": 38
}
```

## Packaging Rules

- `coverImage` is required; package an explicit cover file instead of expecting backend generation
- `overview.html` is optional and no longer required
- Any number of HTML files is allowed
- All local references must use zip-internal relative paths
- Do not inline large report images as base64/data URI
- Put report images in files under `assets/` or equivalent directories

## Upload Workflow

1. Call `mcp__wwwd-reports__get_report_spec`
2. Build the report folder and `manifest.json`
3. Verify `entryHtml` exists and all relative paths resolve
4. Zip the report root
5. Call `mcp__wwwd-reports__prepare_report_upload`
6. Upload the zip directly to the returned OSS `upload.url` using HTTP `PUT` and the returned headers
7. Call `mcp__wwwd-reports__complete_report_upload`
8. Poll `mcp__wwwd-reports__get_report_upload_status` until status is `completed`
9. Call `mcp__wwwd-reports__list_reports` to verify publish success

## Two-Phase Upload Notes

- Do not send large zip payloads through MCP JSON directly unless you are doing local debugging
- `prepare_report_upload` returns a short-lived signed OSS URL; upload before `expiresAt`
- `complete_report_upload` only starts backend processing after the OSS object is present
- `get_report_upload_status` is the source of truth for `pending` / `processing` / `completed` / `failed`
