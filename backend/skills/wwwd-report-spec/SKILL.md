# AiModa Fashion Report Zip Spec v2.1

AiModa 正式报告上传规范。OpenClaw 或其他生成 Agent 在打包 zip 前必须遵循本规范。

---

## 1. 核心原则

- 平台强制要求一个主入口 HTML；封面图改为可推断
- 报告可以包含任意数量的 HTML 页面
- 所有页面、图片、CSS、JS、JSON 必须使用 **zip 内部相对路径** 引用
- 正文图片应以文件形式放在 zip 内，**不要把大图以 base64/data URI 内嵌到 HTML**
- 上传后平台会保留 zip 内相对目录结构，并以 `manifest.json` 中的 `entryHtml` 作为主入口

---

## 2. 推荐目录结构

```text
{report-root}/
├── manifest.json               # 必需
├── pages/                      # 推荐
│   ├── report.html             # 必需：主入口页面
│   └── *.html                  # 可选：任意附加页面
├── assets/                     # 推荐：图片/样式/脚本资源
│   ├── cover.jpg               # 可选：兼容旧封面图
│   ├── look-001.jpg
│   ├── look-002.jpg
│   ├── styles.css
│   └── ...
└── image-features.json         # 可选：图像特征/结构化分析结果
```

兼容说明：

- `pages/`、`assets/` 是推荐目录，不是唯一合法目录
- 只要 `manifest.json` 中声明的相对路径真实存在即可
- 旧格式若没有 `manifest.json`，平台仍可回退使用根目录 `index.html`

---

## 3. manifest.json 规范

### 必填字段

```json
{
  "specVersion": "2.0",
  "slug": "murmur-aw-2026-27-v5-2",
  "title": "Murmur 2026-27 秋冬 时装周快报",
  "brand": "Murmur",
  "season": "AW",
  "year": 2026,
  "entryHtml": "pages/report.html"
}
```

### 推荐扩展字段

```json
{
  "reportType": "fashion_week_brief",
  "pages": [
    "pages/report.html",
    "pages/data.html"
  ],
  "overviewHtml": null,
  "coverImage": null,
  "featuresFile": "image-features.json",
  "lookCount": 38,
  "version": "v5.2"
}
```

### 字段说明

- `slug`: 报告唯一标识，建议仅使用小写字母、数字、中横线
- `title`: 报告标题
- `brand`: 品牌名
- `season`: 季节标识，如 `AW`、`SS`、`Fall`、`Spring`
- `year`: 主年份，使用整数
- `entryHtml`: 主入口 HTML 的相对路径
- `coverImage`: 可选，封面图相对路径；不填时平台会自动取 `entryHtml` 第一张本地图片
- `pages`: 可选，列出其他 HTML 页面
- `overviewHtml`: 可选；平台不再强制该页面存在
- `featuresFile`: 可选，结构化分析数据文件
- `lookCount`: 可选；如未提供，平台会尝试从 `featuresFile` 或图片文件数推断

---

## 4. HTML / 资源引用规则

### 必须遵守

- 资源引用必须使用相对路径，例如：
  - `../assets/look-001.jpg`
  - `./data.html`
  - `../assets/styles.css`
- 不允许使用 zip 外部本地绝对路径
- 不建议使用大体积 `data:image/...;base64,...`

### 推荐做法

```html
<link rel="stylesheet" href="../assets/styles.css">
<img src="../assets/look-001.jpg" alt="Look 1">
<a href="./data.html">查看数据页</a>
```

### 不推荐做法

```html
<img src="data:image/jpg;base64,...超大内容...">
<img src="/Users/name/Desktop/look-001.jpg">
<a href="/data.html">绝对路径跳转</a>
```

---

## 5. 封面与附加页面

- `coverImage` 不是必填
- 如显式提供封面图，推荐使用 `assets/cover.jpg`
- 如未提供，平台会自动使用 `entryHtml` 第一张本地图片作为封面
- 如果首屏没有本地图片，上传会失败
- `overview.html` 不再是平台必需文件
- 报告中是否存在数据页、附录页、品牌页，都只视为“附加 HTML 页面”

---

## 6. 上传前检查清单

- [ ] zip 根目录中存在 `manifest.json`（新格式）
- [ ] `manifest.json` 中的 `entryHtml` 指向真实文件
- [ ] 如填写 `coverImage`，它指向真实文件
- [ ] 如未填写 `coverImage`，`entryHtml` 首屏至少有一张本地图片
- [ ] 所有 HTML/CSS/JS/图片引用均为 zip 内相对路径
- [ ] 正文图片未以内联 base64 大图方式嵌入
- [ ] `slug`、`title`、`brand`、`season`、`year` 已填写
- [ ] `featuresFile`、`pages`、可选 `coverImage` 中声明的路径都真实存在

---

## 7. 平台上传行为

- 平台会保留 zip 内相对目录结构上传到 OSS
- 平台会以 `manifest.json.entryHtml` 作为主 iframe 地址
- 平台会优先使用 `manifest.json.coverImage`，否则回退到 `entryHtml` 第一张本地图片作为报告封面
- `overviewHtml` 缺失不会阻止上传
- 没有 `manifest.json` 时，平台兼容旧格式 `index.html`，并优先使用 `cover.jpg`
