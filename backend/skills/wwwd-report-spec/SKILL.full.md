# WWWD 报告规范 Skill

这是 World Wear Watch Daily (WWWD) 时尚趋势报告的完整规范，Agent 在生成新报告前必须查阅此规范。

## 1. 文件夹结构

```
{brand}-{season}-{year}/
├── index.html          # 全屏滚动报告（主页面）
├── overview.html       # 品牌纵览 Dashboard
├── cover.jpg           # 封面图片（首页截图，必需）
├── metadata.json       # 报告元数据（可选）
└── images/
    ├── look-01.jpg     # 原始秀场图片 (命名: look-NN.jpg)
    ├── look-02.jpg
    └── ...
    └── compressed/
        ├── look-01-400.jpg    # 缩略图 (400px 宽度)
        ├── look-01-800.jpg    # 中图 (800px 宽度)
        └── ...
```

### 命名规范
- 文件夹: `{品牌英文名}-{季节}-{年份}`，使用中横线分隔
  - 示例: `zimmermann-fall-2026`, `chanel-spring-2027`, `dior-resort-2027`
- 季节缩写: `fall`, `spring`, `summer`, `winter`, `resort`, `pre-fall`, `cruise`
- 图片: `look-{NN}.jpg`，使用两位数序号 (01, 02, ... 52)
- 封面: `cover.jpg`，必须是报告首页（index.html 第一页）的截图

---

## 2. CSS 变量规范

### 亮色模式 (默认)
```css
:root {
  /* 主色调 */
  --primary: #1a1a1a;
  --secondary: #555555;
  --muted: #888888;

  /* 背景色 */
  --background: #ffffff;
  --background-secondary: #f8f9fa;
  --background-tertiary: #f1f3f5;

  /* 边框 */
  --border: #e5e7eb;

  /* 文字 */
  --text-primary: #111827;
  --text-secondary: #4b5563;
  --text-muted: #9ca3af;

  /* 强调色 */
  --accent: #1a1a1a;
}
```

### 暗色模式
```css
.dark {
  --primary: #f5f5f5;
  --secondary: #a3a3a3;
  --muted: #525252;

  --background: #0f0f0f;
  --background-secondary: #171717;
  --background-tertiary: #1f1f1f;

  --border: #262626;

  --text-primary: #f5f5f5;
  --text-secondary: #a3a3a3;
  --text-muted: #525252;

  --accent: #f5f5f5;
}
```

---

## 3. 字体规范

### Google Fonts 引入
```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
```

### 字体使用规则
- **标题**: `font-family: 'Playfair Display', Georgia, serif;`
  - 用于品牌名、章节标题
  - 字重: 400-600

- **正文**: `font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;`
  - 用于描述文字、统计数据
  - 字重: 300-500
  - 行高: 1.5-1.6

---

## 4. index.html 规范（主报告页面）

### 页面结构
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{品牌} {季节} {年份} RTW | 关键风格分析</title>
  <!-- 引入字体 -->
  <link href="fonts.googleapis.com/..." rel="stylesheet">
  <!-- 引入或内联 CSS -->
  <style>/* CSS 变量和样式 */</style>
</head>
<body>
  <div class="page-container">
    <!-- 封面 -->
    <section class="page cover" id="cover">
      <header class="page-header">
        <span class="header-tag">{品牌}</span>
        <span class="header-info">{季节} {年份}</span>
      </header>
      <div class="cover">
        <div class="cover-left">
          <span class="cover-season">{季节} {年份}</span>
          <h1 class="cover-brand">{品牌}</h1>
          <div class="cover-divider"></div>
          <h2 class="cover-title">关键风格分析</h2>
        </div>
        <div class="cover-right">
          <img src="images/look-01.jpg" alt="Cover">
        </div>
      </div>
    </section>

    <!-- 风格系列页 -->
    <section class="page" id="section-1">
      <header class="page-header">...</header>
      <div class="content">...</div>
    </section>

    <!-- 更多页面... -->
  </div>

  <!-- 导航点 -->
  <nav class="nav-dots">...</nav>

  <!-- 图片灯箱 -->
  <div class="lightbox">...</div>

  <!-- JavaScript -->
  <script>...</script>
</body>
</html>
```

### 布局规则
- **滚动模式**: `scroll-snap-type: y mandatory`
- **每页高度**: `100vh`
- **对齐方式**: `scroll-snap-align: start`

### 必需组件

#### 1. 页面头部 (page-header)
```css
.page-header {
  height: 65px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 45px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
```

#### 2. 封面布局 (cover)
- 左侧 36%: 品牌信息文字
- 右侧 64%: 主图
- 使用 Flexbox 布局

#### 3. 内容页
- 全屏图片展示
- 图片可点击放大 (lightbox)
- 底部导航点指示当前位置

#### 4. 导航点 (nav-dots)
```css
.nav-dots {
  position: fixed;
  right: 25px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nav-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
  cursor: pointer;
}
.nav-dot.active {
  background: var(--primary);
  transform: scale(1.3);
}
```

#### 5. 图片灯箱 (lightbox)
```css
.lightbox {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.96);
  z-index: 10000;
  display: none;
  justify-content: center;
  align-items: center;
}
.lightbox.active {
  display: flex;
}
```

---

## 5. overview.html 规范（品牌纵览 Dashboard）

### 页面结构
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <!-- 与 index.html 相同的头部 -->
</head>
<body>
  <div class="page-container">
    <section class="page overview" id="overview">
      <header class="page-header">...</header>
      <div class="overview-grid">
        <!-- 左侧: 38% - 缩略图网格 -->
        <div class="overview-left">
          <div class="looks-grid">
            <!-- 按风格系列分组的缩略图 -->
          </div>
        </div>

        <!-- 中间: 35% - 统计分析 -->
        <div class="overview-center">
          <div class="chart color-chart">色彩统计</div>
          <div class="chart silhouette-chart">廓形统计</div>
          <div class="chart fabric-chart">面料统计</div>
        </div>

        <!-- 右侧: 27% - 雷达图和总结 -->
        <div class="overview-right">
          <div class="radar-chart">风格雷达图</div>
          <div class="style-breakdown">风格占比</div>
          <div class="season-summary">季度总结</div>
        </div>
      </div>
    </section>
  </div>
</body>
</html>
```

### Dashboard 布局比例
- 左侧缩略图: 38%
- 中间统计: 35%
- 右侧分析: 27%

---

## 6. iframe 嵌入规范

### 外部容器
```html
<iframe
  src="{report-path}/index.html"
  style="
    width: 100%;
    height: 100%;
    border: none;
  "
  allow="fullscreen"
></iframe>
```

### 样式隔离
- 使用 iframe 天然隔离外部样式
- 报告内部使用独立 CSS 变量
- 不依赖外部平台的 CSS

### 响应式
- 移动端: 自适应宽度，高度动态
- 平板: 保持比例缩放
- 桌面: 全屏展示

---

## 7. 图片规范

### 图片尺寸
| 类型 | 尺寸 | 用途 |
|------|------|------|
| 原始 | 原图 | 灯箱查看 |
| 800 | 800px 宽度 | 桌面展示 |
| 400 | 400px 宽度 | 缩略图/Mobile |

### 格式
- 格式: JPEG
- 质量: 80-90%
- 命名: `look-{NN}.jpg` 或 `look-{NN}-{size}.jpg`

---

## 8. 主题支持

### 检测外部主题
```javascript
// 检测父窗口是否为暗色模式
const prefersDark = window.parent?.matchMedia?.('(prefers-color-scheme: dark)')?.matches;

// 或通过 URL 参数
const urlParams = new URLSearchParams(window.location.search);
const theme = urlParams.get('theme'); // 'light' 或 'dark'
```

### 动态切换
```javascript
if (prefersDark || theme === 'dark') {
  document.documentElement.classList.add('dark');
}
```

---

## 9. 示例：完整 index.html 模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{Brand}} {{Season}} {{Year}} RTW | 关键风格分析</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
    <style>
        /* CSS 变量 */
        :root {
            --primary: #1a1a1a;
            --secondary: #555;
            --light: #f5f5f5;
            --border: #ddd;
            --background: #ffffff;
            --text-primary: #1a1a1a;
            --text-secondary: #555;
        }

        .dark {
            --primary: #f5f5f5;
            --secondary: #a3a3a3;
            --light: #1f1f1f;
            --border: #2d2d2d;
            --background: #0a0a0a;
            --text-primary: #f5f5f5;
            --text-secondary: #a3a3a3;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--background);
            color: var(--primary);
            line-height: 1.5;
        }

        .page-container {
            width: 100vw;
            height: 100vh;
            overflow-y: scroll;
            scroll-snap-type: y mandatory;
        }

        .page {
            width: 100vw;
            height: 100vh;
            scroll-snap-align: start;
            background: var(--background);
            position: relative;
            overflow: hidden;
        }

        .page-header {
            height: 65px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 45px;
            background: var(--background);
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .cover {
            display: flex;
            flex: 1;
            min-height: 0;
        }

        .cover-left {
            width: 36%;
            background: var(--light);
            padding: 50px 45px;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .cover-season {
            font-size: 15px;
            letter-spacing: 5px;
            color: var(--secondary);
            text-transform: uppercase;
        }

        .cover-brand {
            font-family: 'Playfair Display', serif;
            font-size: 58px;
            font-weight: 500;
            color: var(--primary);
            margin-bottom: 12px;
        }

        .cover-title {
            font-size: 22px;
            font-weight: 400;
            letter-spacing: 5px;
            color: var(--secondary);
        }

        .cover-right {
            width: 64%;
            position: relative;
            overflow: hidden;
        }

        .cover-right img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .nav-dots {
            position: fixed;
            right: 25px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .nav-dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            background: #ccc;
            cursor: pointer;
            transition: all 0.3s;
        }

        .nav-dot:hover, .nav-dot.active {
            background: var(--primary);
            transform: scale(1.3);
        }

        .lightbox {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.96);
            z-index: 10000;
            justify-content: center;
            align-items: center;
            cursor: zoom-out;
        }

        .lightbox.active { display: flex; }

        .lightbox img {
            max-width: 94vw;
            max-height: 94vh;
            object-fit: contain;
        }
    </style>
</head>
<body>
    <div class="page-container">
        <!-- 封面 -->
        <section class="page cover" id="cover">
            <header class="page-header">
                <span class="header-tag">{{Brand}}</span>
                <span class="header-info">{{Season}} {{Year}}</span>
            </header>
            <div class="cover">
                <div class="cover-left">
                    <span class="cover-season">{{Season}} {{Year}}</span>
                    <h1 class="cover-brand">{{Brand}}</h1>
                    <div class="cover-divider"></div>
                    <h2 class="cover-title">关键风格分析</h2>
                </div>
                <div class="cover-right">
                    <img src="images/look-01.jpg" alt="Cover">
                </div>
            </div>
        </section>

        <!-- 更多页面... -->
    </div>

    <nav class="nav-dots">
        <span class="nav-dot active" data-target="cover"></span>
    </nav>

    <div class="lightbox">
        <img src="" alt="Zoomed">
    </div>

    <script>
        // 导航逻辑
        // 灯箱逻辑
    </script>
</body>
</html>
```

---

## 10. 快速参考清单

生成新报告前检查：

- [ ] 文件夹命名符合规范 (`{brand}-{season}-{year}`)
- [ ] 包含 `index.html` 和 `overview.html`
- [ ] 图片放在 `images/` 目录
- [ ] 使用正确的 CSS 变量
- [ ] 引入 Playfair Display 和 Inter 字体
- [ ] 实现 `scroll-snap` 滚动
- [ ] 实现导航点组件
- [ ] 实现图片灯箱
- [ ] 支持主题切换（亮色/暗色）
- [ ] 设置正确的 meta 标签
- [ ] 生成封面截图 cover.jpg（必需）

---

## 11. 封面截图规范

### 封面要求
- **文件名**: `cover.jpg`
- **位置**: 报告文件夹根目录（与 index.html 同级）
- **尺寸**: 宽度 1200px，高度按首页实际比例（建议 630px 或 1200x900 4:3 比例）
- **格式**: JPEG，质量 85%
- **内容**: index.html 首页（封面页）的完整截图

### 截图流程

使用 Playwright MCP 工具截取首页：

```markdown
1. 在报告文件夹本地生成完成后，使用 Playwright 打开 index.html：
   mcp__playwright__browser_navigate({ url: "file://{绝对路径}/index.html" })

2. 等待页面完全加载（字体、图片）：
   mcp__playwright__browser_wait_for({ time: 2 })

3. 截取视口作为封面：
   mcp__playwright__browser_take_screenshot({
     filename: "{报告文件夹路径}/cover.jpg",
     type: "jpeg"
   })

4. 将 cover.jpg 与报告文件一起打包成 zip 上传
```

### 截图要点

1. **等待加载**: 确保字体和图片完全加载后再截图
2. **亮色模式**: 使用默认亮色模式截图（与平台列表页一致）
3. **视口大小**: 默认视口即可，或设置为 1200x900 获得标准封面
4. **文件格式**: 必须是 JPEG 格式，避免 PNG 过大

### 完整上传流程

```markdown
1. 生成报告文件（index.html, overview.html, images/）
2. 使用 Playwright 截取首页保存为 cover.jpg
3. 将所有文件打包为 {brand}-{season}-{year}.zip
4. 调用 mcp__wwwd-reports__upload_report 获取上传 URL
5. POST zip 到上传 URL
```

### 降级处理
如果截图失败，可以：
- 跳过 cover.jpg，平台将使用默认占位图
- 但为了最佳展示效果，强烈建议提供封面