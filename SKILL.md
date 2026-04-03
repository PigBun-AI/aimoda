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
      url: "https://www-d.net/api/mcp"
---

# WWWD Reports

Use this skill when OpenClaw is preparing a report zip for AiModa / WWWD upload.

## First Rule

Always call `mcp__wwwd-reports__get_report_spec` before packaging a report.

## Current Zip Spec

The platform now uses **manifest + entryHtml + relative-path assets**.

### Required

```text
{report-root}/
├── manifest.json
└── {entryHtml declared in manifest}
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
5. Call `mcp__wwwd-reports__upload_report`
6. Call `mcp__wwwd-reports__list_reports` to verify publish success
