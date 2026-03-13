---
name: wwwd-reports
description: "Generate and upload fashion trend reports to WWWD platform. Use when: creating brand/season trend reports, uploading fashion analysis reports, generating HTML reports with look images. NOT for: real-time data queries, scheduling automation, non-fashion content."
metadata:
  openclaw:
    emoji: "👗"
    requires:
      bins: ["curl", "zip"]
      packages: []
    mcp:
      server: "wwwd-reports"
      url: "https://www-d.net/api/mcp"
---

# WWWD Reports

Generate and upload fashion trend reports to World Wear Watch Daily (WWWD) platform via MCP tools.

---

## When to Use

**Use this skill when:**
- Creating fashion brand trend analysis reports
- Uploading completed reports to WWWD platform
- Generating HTML-based visual reports with look images
- Producing seasonal collection analysis (Fall, Spring, Resort, etc.)
- Creating brand overview dashboards with statistics

**DON'T use this skill when:**
- Real-time data queries or live feeds
- Automated scheduling or cron jobs
- Non-fashion industry content
- Simple text documents without visual elements

---

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `mcp__wwwd-reports__get_report_spec` | Get report specification including folder structure, naming conventions, CSS variables, and HTML templates. **Call this FIRST before generating any report.** |
| `mcp__wwwd-reports__upload_report` | Upload report zip file to WWWD platform. Returns upload URL and method. |

---

## Report Structure

```
{brand}-{season}-{year}/
├── index.html          # Main scrolling report (required)
├── overview.html       # Brand dashboard (required)
├── metadata.json       # Report metadata (optional)
└── images/
    ├── look-01.jpg              # Runway images (任意命名)
    ├── look-02.jpg
    ├── zimmermann-detail.jpg    # 支持描述性命名
    └── compressed/              # 可选：压缩版本
        ├── look-01-400.jpg      # Thumbnails (400px width)
        └── look-01-800.jpg      # Medium size (800px width)
```

**注意**：图片数量不限，命名格式自由。

### Naming Conventions

| Element | Format | Examples |
|---------|--------|----------|
| Folder | `{brand}-{season}-{year}` | `zimmermann-fall-2026`, `chanel-spring-2027` |
| Season | Lowercase abbreviations | `fall`, `spring`, `summer`, `winter`, `resort`, `pre-fall`, `cruise` |
| Images | **任意命名** | `look-01.jpg`, `zimmermann-fall-2026-look-01.jpg`, `detail-embroidery.jpg` |

### Image Guidelines

- **无数量限制**：图片数量由报告内容决定
- **格式支持**：`.jpg`, `.jpeg`, `.png`, `.webp`
- **命名自由**：只要 `index.html` 能正确引用即可
- **推荐命名**：
  - 顺序编号：`look-01.jpg`, `look-02.jpg`
  - 完整描述：`zimmermann-fall-2026-look-01.jpg`
  - 细节图：`detail-embroidery.jpg`, `fabric-closeup.jpg`

---

## Common Workflows

### 1. Generate New Report

**Step 1: Get Specification**
```
Call: mcp__wwwd-reports__get_report_spec
Returns: Full documentation with CSS variables, HTML templates, layout rules
```

**Step 2: Create Folder Structure**
```bash
mkdir -p {brand}-{season}-{year}/images/compressed
```

**Step 3: Create index.html**
- Use scroll-snap for full-page scrolling
- Include page-header, cover, navigation dots, lightbox
- Apply CSS variables for light/dark mode support
- Use Google Fonts: Playfair Display (titles) + Inter (body)

**Step 4: Create overview.html**
- Three-column layout: thumbnails (38%) | statistics (35%) | analysis (27%)
- Include color palette, silhouette/fabric distribution charts
- Add style radar chart and season summary

**Step 5: Prepare Images**
```bash
# Create compressed versions
for img in images/look-*.jpg; do
  sips --resampleWidth 400 "$img" --out "images/compressed/$(basename ${img%.jpg})-400.jpg"
  sips --resampleWidth 800 "$img" --out "images/compressed/$(basename ${img%.jpg})-800.jpg"
done
```

**Step 6: Create metadata.json (optional)**
```json
{
  "brand": "Brand Name",
  "season": "Fall",
  "year": 2026,
  "collection_type": "RTW",
  "total_looks": 42,
  "style_categories": [...],
  "color_palette": ["#1a1a1a", "#f5f5f5"],
  "generated_at": "2026-03-13"
}
```

---

### 2. Upload Report

**Step 1: Get Upload URL**
```
Call: mcp__wwwd-reports__upload_report
Returns: { uploadUrl, method, contentType, fields }
```

**Step 2: Package Report**
```bash
zip -r {brand}-{season}-{year}.zip {brand}-{season}-{year}/
```

**Step 3: Upload**
```bash
curl -X POST "https://www-d.net/api/mcp/upload" \
  -F "file=@{brand}-{season}-{year}.zip" \
  -F "uploadedBy=1"
```

**Step 4: Verify Response**
```json
{
  "success": true,
  "message": "报告上传成功",
  "report": {
    "id": 123,
    "slug": "brand-season-year",
    "title": "Brand Season Year RTW | 关键风格分析",
    "brand": "Brand",
    "season": "Season Year",
    "lookCount": 42
  }
}
```

---

## CSS Variables Reference

### Light Mode (Default)
```css
:root {
  --primary: #1a1a1a;
  --secondary: #555555;
  --muted: #888888;
  --background: #ffffff;
  --border: #e5e7eb;
  --text-primary: #111827;
  --text-secondary: #4b5563;
}
```

### Dark Mode
```css
.dark {
  --primary: #f5f5f5;
  --secondary: #a3a3a3;
  --muted: #525252;
  --background: #0f0f0f;
  --border: #262626;
  --text-primary: #f5f5f5;
  --text-secondary: #a3a3a3;
}
```

---

## Required Fonts

```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
```

| Font | Usage | Weights |
|------|-------|---------|
| Playfair Display | Brand names, section titles | 400-600 |
| Inter | Body text, statistics, descriptions | 300-500 |

---

## Key Components Checklist

Before uploading, verify:

- [ ] Folder name follows `{brand}-{season}-{year}` format
- [ ] Contains `index.html` (main report)
- [ ] Contains `overview.html` (dashboard)
- [ ] **Contains `cover.jpg` (16:9 截图，必须用 Playwright)**
- [ ] Images in `images/` directory with correct naming
- [ ] CSS variables implemented for light/dark mode
- [ ] Google Fonts imported (Playfair Display + Inter + Noto Sans SC)
- [ ] scroll-snap implemented for page navigation
- [ ] Navigation dots component included
- [ ] Lightbox for image zoom implemented
- [ ] Valid HTML meta tags set

---

## Cover Screenshot (重要)

**封面必须使用 Playwright 截取真实页面，不能手动绘制！**

### 为什么不能手动绘制？

| 问题 | 原因 |
|------|------|
| 中文字体丢失 | 手动绘制无法加载 Google Fonts |
| 样式位置不对 | CSS 布局无法完美还原 |
| 颜色不一致 | 颜色值计算方式不同 |

### 正确的截图流程

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})

    # 加载页面
    page.goto('file:///path/to/index.html', wait_until='networkidle')

    # 等待字体加载
    page.wait_for_timeout(2000)

    # 截取封面 (16:9)
    page.screenshot(
        path='cover.jpg',
        type='jpeg',
        quality=85,
        full_page=False  # 只截取视口，不是全页面
    )

    browser.close()
```

### 封面规格

| 属性 | 要求 |
|------|------|
| 比例 | 16:9 |
| 推荐尺寸 | 1920x1080 或 1280x720 |
| 格式 | JPEG |
| 质量 | 85% |
| 内容 | index.html 首屏截图 |

---

## Notes

- **Platform**: WWWD (World Wear Watch Daily)
- **API Endpoint**: `https://www-d.net/api/mcp`
- **Report Format**: HTML with embedded CSS/JS
- **Image Format**: JPEG/PNG/WebP, 80-90% quality
- **Image Count**: 无限制
- **Image Naming**: 自由命名，支持数字、字母、中横线
- **Languages**: Chinese (zh-CN) for content, English for brand/season names
- **Theme Support**: Must support both light and dark modes via CSS classes

---

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| Upload fails | Invalid zip structure | Verify folder naming and required files |
| Images not loading | Wrong path or format | Check image path matches `index.html` references |
| CSS broken | Missing variables | Include full CSS variables in `:root` |
| Fonts not loading | Missing import | Add Google Fonts link in `<head>` |