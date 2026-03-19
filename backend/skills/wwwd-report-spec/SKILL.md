# WWWD 报告规范

World Wear Watch Daily (WWWD) 时尚趋势报告的资源层级规范。

---

## 1. 文件夹结构

```
{brand}-{season}-{year}/
├── index.html          # 必需：主报告页面
├── cover.jpg           # 必需：封面图片（首页截图）
├── overview.html       # 必需：品牌纵览页面
├── metadata.json       # 可选：元数据
└── images/             # 图片资源目录
    ├── look-01.jpg
    ├── look-02.jpg
    ├── zimmermann-fall-detail.jpg
    └── ...
```

### 命名规范

| 元素 | 规范 | 示例 |
|------|------|------|
| 文件夹 | `{品牌英文名}-{季节}-{年份}` | `zimmermann-fall-2026` |
| 季节 | 小写英文 | `fall`, `spring`, `resort`, `pre-fall` |
| 封面 | `cover.jpg` | 固定文件名 |
| 图片 | 任意命名，支持数字和字母 | `look-01.jpg`, `zimmermann-fall-detail.jpg`, `runway-001.webp` |

### 图片命名说明

- **无数量限制**：图片数量不限，由 `index.html` 自由引用
- **格式灵活**：支持 `.jpg`、`.jpeg`、`.png`、`.webp` 格式
- **命名自由**：只要 `index.html` 能正确引用即可，推荐使用有意义的命名如：
  - `look-01.jpg` - 顺序编号
  - `zimmermann-fall-2026-look-01.jpg` - 完整描述
  - `detail-embroidery.jpg` - 细节图

---

## 2. 必需文件

### index.html
- 主报告页面，用户浏览的核心内容
- 可嵌入 iframe 中展示
- 形式不限（滚动式、分页式、交互式等）
- **必须支持响应式布局**（详见第 6 节）

### cover.jpg
- 报告封面的预览图
- 用于列表页展示
- **比例**：16:9（宽高比）
- **推荐尺寸**：1920x1080 px 或 1280x720 px
- **格式**：JPEG，质量 85%
- **内容**：报告首页的完整截图

#### 封面截图注意事项（重要）

1. **必须使用 Playwright 截取真实页面**
   - 不能手动绘制封面（会导致字体丢失、样式不一致）
   - 必须从渲染后的 index.html 截图

2. **截图流程**
   ```python
   from playwright.sync_api import sync_playwright

   with sync_playwright() as p:
       browser = p.chromium.launch()
       page = browser.new_page(viewport={'width': 1920, 'height': 1080})
       page.goto('file:///path/to/index.html', wait_until='networkidle')
       page.wait_for_timeout(2000)  # 等待字体加载
       page.screenshot(path='cover.jpg', type='jpeg', quality=85, full_page=False)
       browser.close()
   ```

3. **常见问题**
   | 问题 | 原因 | 解决方案 |
   |------|------|----------|
   | 中文字体丢失 | 手动绘制未加载字体 | 使用 Playwright 截取真实页面 |
   | 样式位置不对 | 手动绘制无法还原 CSS | 使用 Playwright 截取真实页面 |
   | 封面模糊 | 截图尺寸过小 | 使用 1920x1080 截图 |
   | 比例错误 | 3:4 而非 16:9 | viewport 设置为 1920x1080 |

4. **确保字体加载完成**
   - 使用 `wait_until='networkidle'` 等待网络空闲
   - 额外等待 2 秒确保 Google Fonts 加载
   - 检查 index.html 已引入 Google Fonts：
     ```html
     <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500&family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
     ```

---

## 3. 可选文件

### overview.html
- 品牌纵览、数据看板（**上传时必需**）
- 与主报告页面风格独立

### metadata.json
```json
{
  "brand": "Zimmermann",
  "season": "Fall",
  "year": 2026,
  "title": "Zimmermann Fall 2026 RTW 趋势报告",
  "lookCount": 16,
  "description": "可选的描述文字"
}
```

### images/
- 存放报告用到的图片资源
- 可自行组织子目录结构
- **图片数量不限**
- **命名格式自由**：支持数字、字母、中横线等，如 `look-01.jpg`、`zimmermann-fall-detail.jpg`、`runway-001.webp`
- 支持 `.jpg`、`.jpeg`、`.png`、`.webp` 格式

---

## 4. 上传流程

```
1. 生成报告文件
2. 截取首页保存为 cover.jpg
3. 打包为 zip 文件
4. 调用 upload_report 上传
```

### 截图方法

使用 Playwright 截取首页：

```markdown
1. browser_navigate({ url: "file:///{报告路径}/index.html" })
2. browser_wait_for({ time: 2 })
3. browser_take_screenshot({ filename: "cover.jpg", type: "jpeg" })
```

---

## 5. 注意事项

- 报告会在 iframe 中嵌入展示，确保样式自包含
- 如使用外部资源（字体、CDN），确保可公开访问
- 封面图 quality 建议 85%，平衡清晰度和文件大小

---

## 6. 响应式设计规范

报告需要在多种设备上展示（手机、平板、桌面），必须遵循以下响应式原则：

### 6.1 视口设置

**必须在 `<head>` 中设置 viewport**：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
```

### 6.2 断点策略

采用 Mobile-First（移动优先）策略：

| 断点 | 宽度 | 设备 |
|------|------|------|
| 默认 | < 640px | 手机竖屏 |
| `sm` | ≥ 640px | 手机横屏/小平板 |
| `md` | ≥ 768px | 平板竖屏 |
| `lg` | ≥ 1024px | 平板横屏/笔记本 |
| `xl` | ≥ 1280px | 桌面显示器 |

```css
/* Mobile-first 媒体查询示例 */
.container {
  padding: 1rem; /* Mobile */
}

@media (min-width: 768px) {
  .container {
    padding: 2rem; /* Tablet */
  }
}

@media (min-width: 1024px) {
  .container {
    padding: 3rem; /* Desktop */
  }
}
```

### 6.3 布局要求

#### 弹性布局
```css
/* 使用 Flexbox 或 Grid */
.page {
  display: flex;
  flex-direction: column; /* 移动端纵向排列 */
}

@media (min-width: 768px) {
  .page {
    flex-direction: row; /* 桌面端横向排列 */
  }
}
```

#### 避免固定宽度
```css
/* 错误：固定宽度 */
.wrong { width: 1200px; }

/* 正确：响应式宽度 */
.correct {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}
```

### 6.4 字体规范

#### 流体字体
```css
/* 使用 clamp() 实现流体字体 */
h1 {
  font-size: clamp(1.5rem, 4vw, 3rem);
}

h2 {
  font-size: clamp(1.25rem, 3vw, 2rem);
}

p {
  font-size: clamp(0.875rem, 2vw, 1rem);
  line-height: 1.6;
}
```

#### 最小字体
- 正文：不小于 `14px`（移动端）
- 标题：不小于 `18px`（移动端）

### 6.5 图片处理

#### 响应式图片
```css
img {
  max-width: 100%;
  height: auto;
  display: block;
}
```

#### 图片容器
```css
/* 固定宽高比容器 */
.image-container {
  position: relative;
  width: 100%;
  padding-bottom: 56.25%; /* 16:9 */
}

.image-container img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

### 6.6 触摸友好

#### 触摸目标尺寸
- 按钮最小尺寸：`44px × 44px`
- 链接间距：至少 `8px`

```css
button, a {
  min-height: 44px;
  min-width: 44px;
  padding: 12px 16px;
}
```

#### 避免悬停依赖
```css
/* 移动端禁用 hover 效果 */
@media (hover: hover) {
  .card:hover {
    transform: scale(1.02);
  }
}
```

### 6.7 iframe 嵌入适配

报告会嵌入 iframe 中展示，需要处理：

```css
/* 全屏适配 */
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow-x: hidden; /* 防止横向滚动 */
}

/* 安全区域（刘海屏适配） */
@supports (padding: env(safe-area-inset-bottom)) {
  .bottom-nav {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

### 6.8 性能优化

#### 图片懒加载
```html
<img src="look-01.jpg" loading="lazy" alt="...">
```

#### 减少动画
```css
/* 尊重用户偏好 */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 7. 快速检查清单

生成报告前确认：

- [ ] 设置 viewport meta 标签
- [ ] 使用 Mobile-First 断点策略
- [ ] 避免固定宽度，使用 `max-width`
- [ ] 字体使用 `clamp()` 或响应式单位
- [ ] 图片 `max-width: 100%`
- [ ] 按钮/链接触摸区域 ≥ 44px
- [ ] 在 iframe 中测试展示效果
- [ ] 测试 375px、768px、1024px、1440px 宽度

上传前确认：

- [ ] 文件夹命名符合 `{brand}-{season}-{year}` 格式
- [ ] 包含 `index.html` 和 `overview.html`（两者均为必需）
- [ ] **封面使用 Playwright 截取**（不是手动绘制）
- [ ] 封面比例 16:9（1920x1080 或 1280x720）
- [ ] 封面包含正确的中文字体
- [ ] 打包为 zip 文件