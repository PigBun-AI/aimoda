# AiModa Fashion Report Zip Spec v2（正式版）

这是 AiModa Fashion Report 的正式上传规范。平台未来以 **manifest + entryHtml + 相对路径资源** 为唯一推荐标准。

## 1. 设计目标

新的规范要解决以下问题：

1. 不再把报告绑死为 `index.html + overview.html + images/` 这种固定形态
2. 允许时装周快报、单页报告、多页专题共用一套上传协议
3. 要求生成 Agent 按平台规范整理 zip，而不是平台去适配任意输出
4. 避免正文大图 base64 内嵌导致 HTML 体积过大、线上首屏慢、缓存失效
5. 上传后保留 zip 内部相对结构，让 HTML 之间和 HTML 对资源的相对引用稳定工作

---

## 2. 规范结论

### 2.1 平台强制要求

一个新格式报告 zip 至少需要：

- `manifest.json`
- `manifest.json.entryHtml` 指向的 HTML 文件

平台不再强制要求：

- `overview.html`
- 固定名 `index.html`
- 固定 `images/` 目录
- 固定只有 1 个或 2 个 HTML 页面

### 2.2 平台推荐要求

推荐使用：

```text
{report-root}/
├── manifest.json
├── pages/
│   ├── report.html
│   └── *.html
├── assets/
│   ├── cover.jpg
│   ├── *.jpg
│   ├── *.png
│   ├── *.webp
│   ├── *.css
│   └── *.js
└── image-features.json
```

说明：

- `pages/`、`assets/` 是推荐布局，不是强制唯一布局
- 平台只认 manifest 里填写的相对路径
- 旧格式没有 manifest 时，会回退到 legacy `index.html`

---

## 3. manifest.json 正式字段

### 3.1 必填字段

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

### 3.2 可选字段

```json
{
  "reportType": "fashion_week_brief",
  "pages": [
    "pages/report.html",
    "pages/data.html",
    "pages/appendix.html"
  ],
  "overviewHtml": null,
  "coverImage": "assets/cover.jpg",
  "featuresFile": "image-features.json",
  "lookCount": 38,
  "version": "v5.2"
}
```

### 3.3 字段语义

- `specVersion`: 当前推荐值 `2.0`
- `slug`: 报告唯一标识，建议标准化为小写字母/数字/中横线
- `title`: 报告展示标题
- `brand`: 品牌名
- `season`: 季节标识，如 `AW`、`SS`、`Fall`、`Spring`
- `year`: 报告主年份，整数
- `entryHtml`: 主入口 HTML，相对路径
- `reportType`: 可选，如 `fashion_week_brief`、`standard_report`
- `pages`: 可选，其他 HTML 页面列表
- `overviewHtml`: 可选，仅用于兼容旧交互概念，不再强制存在
- `coverImage`: 可选，封面图相对路径
- `featuresFile`: 可选，图像特征/结构化分析文件
- `lookCount`: 可选；若缺失，平台会尝试推断
- `version`: 可选，人类可读版本号

---

## 4. HTML 页面规范

### 4.1 entryHtml

- `entryHtml` 必须存在
- 平台会把它作为报告主 iframe 地址
- 它不要求名字必须叫 `index.html`

### 4.2 其他 HTML 页面

- 可以有任意数量
- 只要相对路径合法、文件真实存在即可
- 平台不再对 `overview.html` 做特殊强制要求

### 4.3 资源引用规则

所有 HTML/CSS/JS 中的资源引用都必须使用 **zip 内部相对路径**。

推荐：

```html
<link rel="stylesheet" href="../assets/styles.css">
<img src="../assets/look-001.jpg" alt="Look 1">
<a href="./data.html">查看数据页</a>
<script src="../assets/report.js"></script>
```

禁止：

```html
<img src="/Users/xxx/Desktop/look.jpg">
<img src="C:\\Users\\xxx\\look.jpg">
<a href="/data.html">绝对站点根路径</a>
```

---

## 5. 图片与性能规范

### 5.1 正文图片必须文件化

正文图片应作为 zip 内文件存在，例如：

- `assets/look-001.jpg`
- `assets/look-002.webp`

### 5.2 不建议大图 base64 内嵌

除极小图标或装饰元素外，不建议：

```html
<img src="data:image/jpg;base64,...">
```

原因：

- HTML 体积显著膨胀
- 首屏 HTML 下载变慢
- 图片无法单独缓存
- 浏览器无法对图片做更好的并发/懒加载处理
- MCP / JSON-RPC / base64 上传链路整体更脆弱

### 5.3 封面图

- `coverImage` 可选
- 如提供，推荐放在 `assets/cover.jpg`
- 平台不会再因为没有 `overview.html` 阻止上传

---

## 6. lookCount 推断规则

平台按以下优先级确定 `lookCount`：

1. `manifest.lookCount`
2. `manifest.featuresFile` 对应 JSON 的条目数
3. zip 内图片资源数

因此，如果 Agent 有可靠的结构化结果，推荐显式写入 `lookCount` 或 `featuresFile`。

---

## 7. 上传行为

上传时平台将：

1. 先创建上传任务，返回一个短时有效的 OSS 直传 URL
2. 调用方将 zip 二进制直接上传到 OSS staging object
3. 上传完成后调用 complete 接口，平台才开始异步处理
4. 后端 Worker 下载 staging zip、读取 `manifest.json`
5. 校验必填字段和路径存在性
6. 保留 zip 内相对目录结构上传到正式 OSS 路径
7. 以 `entryHtml` 对应文件作为主入口 URL
8. 如果存在其他 HTML 页面，一并上传
9. 如果存在 `coverImage`，返回其 URL
10. `overviewHtml` 缺失不视为错误

### 7.1 为什么改成两段式

- 避免大 zip 穿过 MCP / Cloudflare / JSON-RPC 链路导致 524 超时
- 把“大文件传输”和“业务处理”解耦
- 上传失败时可以只重试直传或只重试 complete，不必整条链路重来
- 更适合 OpenClaw 这类 Agent 通过 MCP 编排、通过 HTTP 直传 OSS 的模式

---

## 8. OpenClaw / 整理 Agent 的职责

OpenClaw 不是定义上传协议的一方，它的职责是：

1. 生成报告内容
2. 把报告整理为符合本 spec 的 zip
3. 生成 `manifest.json`
4. 把图片从 HTML base64 内嵌改为 zip 内文件引用（推荐）
5. 保证所有页面和资源都用相对路径互相引用
6. 调用 `prepare_report_upload` → 直传 OSS → `complete_report_upload` → 轮询 `get_report_upload_status`

---

## 9. 上传前最终检查清单

- [ ] 有 `manifest.json`
- [ ] `slug/title/brand/season/year/entryHtml` 已填写
- [ ] `entryHtml` 指向真实文件
- [ ] 如有 `pages`，每个页面都真实存在
- [ ] 如有 `coverImage`/`featuresFile`，路径真实存在
- [ ] 所有 HTML/CSS/JS 资源引用都为 zip 内相对路径
- [ ] 正文图片未以超大 base64 方式内嵌
- [ ] zip 解压后可以在本地用相对路径正常打开主页面
