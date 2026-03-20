# Design System

## 1. 概述

本设计系统基于 CSS 变量（CSS Custom Properties）构建，支持亮色模式（Light）与暗色模式（Dark）自动切换。所有语义化 token 均定义在 `frontend/src/index.css` 中，组件应通过 token 名称引用颜色、圆角、阴影等值，而非硬编码具体颜色。

### 设计原则

- **语义化优先**：颜色命名反映用途（primary、secondary、muted、destructive），而非具体色值
- **动态主题**：通过 `prefers-color-scheme` 或手动切换实现亮/暗模式
- **禁止硬编码**：任何颜色、圆角、阴影均需通过 CSS 变量或 Tailwind 的 arbitrary value 方式引用

---

## 2. 颜色系统

### 亮色模式（Light Mode）

| Token                  | 值 (oklch / hex)                          | 用途                              |
|------------------------|-------------------------------------------|-----------------------------------|
| `--background`         | `oklch(1 0 0)`                           | 页面背景（纯白）                   |
| `--foreground`         | `oklch(0.141 0.005 285.823)`             | 主文本（深灰）                     |
| `--primary`            | `oklch(0.21 0.006 285.885)`              | 品牌主色按钮、图标（深紫灰）        |
| `--primary-foreground` | `oklch(0.985 0 0)`                       | 主色按钮上的文字（纯白）            |
| `--secondary`          | `oklch(0.967 0.001 286.375)`            | 次要背景（浅灰）                   |
| `--muted`              | 同 `--secondary`                          | 弱化背景                          |
| `--muted-foreground`   | `oklch(0.552 0.016 285.938)`            | 次要文本（中灰）                   |
| `--accent`             | 同 `--secondary`                          | 强调背景                          |
| `--accent-foreground`   | 同 `--foreground`                         | 强调文字                          |
| `--destructive`        | `oklch(0.577 0.245 27.325)`             | 危险/错误状态（红色）              |
| `--border`             | `oklch(0.92 0.004 286.32)`              | 边框（浅灰）                       |
| `--card`               | 同 `--background`                         | 卡片背景                          |
| `--input`              | 同 `--border`                             | 输入框边框                        |
| `--ring`               | `oklch(0.705 0.015 286.067)`            | 焦点环颜色                        |

### 暗色模式（Dark Mode）

| Token                  | 值 (oklch / hex)                          | 亮色模式对应                      |
|------------------------|-------------------------------------------|-----------------------------------|
| `--background`         | `oklch(0.141 0.005 285.823)`             | 背景变深                          |
| `--foreground`         | `oklch(0.985 0 0)`                       | 文字变浅                          |
| `--primary`            | `oklch(0.92 0.004 286.32)`              | 主色变亮                          |
| `--card`               | `oklch(0.21 0.006 285.885)`              | 卡片变深                          |
| `--border`             | `oklch(1 0 0 / 10%)`                     | 边框半透明                        |
| `--destructive`        | `oklch(0.704 0.191 22.216)`             | 红色变亮（更柔和）                 |
| `--warning`             | `#fbbf24`                                 | 警告色变亮                        |

暗色模式中未单独列出的 token（如 `--secondary`、`--muted-foreground`、`--accent` 等）继承亮色模式的计算逻辑。

### 品牌色（亮色模式）

| Token                   | 值 (hex)   | 用途                          |
|-------------------------|------------|-------------------------------|
| `--brand-orange`        | `#ff8a4c`  | 悬停链接色、装饰元素            |
| `--brand-blue`          | `#4c8aff`  | 链接默认色                     |
| `--brand-green`         | `#00b578`  | 成功/正向状态                  |
| `--brand-orange-light`  | `#fff0e6`  | 橙色浅色背景                   |
| `--brand-blue-light`    | `#e6f0ff`  | 蓝色浅色背景                   |
| `--brand-green-light`   | `#e6f7f1`  | 绿色浅色背景                   |

### 状态色

| Token          | 值 (hex)   | 用途              |
|----------------|------------|-------------------|
| `--success`    | `#00b578`  | 成功状态          |
| `--warning`    | `#f59e0b`  | 警告状态（亮色）  |
| `--info`       | `#3b82f6`  | 信息提示          |
| `--notification` | `#ff5757` | 通知/提醒         |

---

## 3. 排版系统

### 字体栈

```css
/* 无衬线体（UI 文本） */
font-family: Geist, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;

/* 衬线体（标题、装饰） */
font-family: 'Playfair Display', Georgia, serif;
font-weight: 400 | 500 | 600;
```

### 字号

字号通过 Tailwind 默认的 `text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl` / `text-2xl` 等工具类控制。衬线字体（Playfair Display）用于品牌标题，通过 `font-serif` 类指定。

---

## 4. 圆角系统

基于 `--radius: 0.625rem (10px)` 的阶梯式圆角：

| Token           | 计算方式                           | 值     | 用途                    |
|-----------------|------------------------------------|--------|-------------------------|
| `--radius-sm`   | `calc(var(--radius) - 4px)`        | `6px`  | 小型元素（Badge、Tag）   |
| `--radius-md`   | `calc(var(--radius) - 2px)`        | `8px`  | 输入框、下拉框           |
| `--radius`      | `0.625rem`                         | `10px` | 基础圆角（按钮、卡片）    |
| `--radius-lg`   | `var(--radius)`                    | `10px` | 卡片、对话框             |
| `--radius-xl`   | `calc(var(--radius) + 4px)`        | `14px` | 大型卡片、模态框         |
| `--radius-bubble` | `calc(var(--radius) + 0.5rem)`  | `18px` | Chat 消息气泡           |

对应 Tailwind 工具类：

- `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl` — 标准阶梯
- `rounded-bubble` — Chat 气泡专用圆角（18px）

---

## 5. 阴影系统

| Token          | 值                                                | 用途              |
|----------------|---------------------------------------------------|-----------------|
| `--shadow-sm`  | `0 1px 2px 0 rgb(0 0 0 / 0.05)`                 | 微浮动元素        |
| `--shadow-md`  | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` | 卡片、浮层  |
| `--shadow-lg`  | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | 弹窗、下拉  |
| `--shadow-xl`  | `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)` | 模态框、通知 |

对应 Tailwind 工具类：

- `shadow-token-sm`
- `shadow-token-md`
- `shadow-token-lg`
- `shadow-token-xl`

> 暗色模式下阴影更深沉，由 CSS 变量自动切换。

---

## 6. 过渡与动画

### 过渡时长

| Token             | 值      | 用途                         |
|-------------------|---------|------------------------------|
| `--duration-fast`   | `150ms` | 微交互（hover、点击反馈）     |
| `--duration-normal` | `300ms` | 常规过渡（展开、滑入）        |
| `--duration-slow`   | `500ms` | 大型动画（页面切换、模态）     |

对应 Tailwind 工具类：`.duration-fast` / `.duration-normal` / `.duration-slow`

### 缓动曲线

| Token              | 值                                |
|--------------------|-----------------------------------|
| `--ease-out-expo`  | `cubic-bezier(0.16, 1, 0.3, 1)`  |
| `--ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)`  |
| `--ease-in-out`    | `cubic-bezier(0.4, 0, 0.2, 1)`   |

### 滚动条

- `.scrollbar-visible` — 始终显示滚动条
- `.scrollbar-hide` — 隐藏滚动条（移动端常用）

---

## 7. Z-Index 层级

| Token           | 值   | 用途                        |
|-----------------|------|-----------------------------|
| `--z-dropdown`  | `10` | 下拉菜单                    |
| `--z-sticky`    | `20` | Sticky 定位元素              |
| `--z-overlay`   | `40` | 遮罩层                      |
| `--z-modal`     | `50` | 模态对话框                  |
| `--z-popover`   | `60` | Popover / Tooltip           |
| `--z-toast`     | `70` | Toast 通知                  |

对应 Tailwind 工具类：`.z-dropdown` / `.z-sticky` / `.z-overlay` / `.z-modal` / `.z-popover` / `.z-toast`

---

## 8. 禁止模式（Must NOT）

以下做法严格禁止，无论在 `.tsx`、`.ts` 还是 `.css` 文件中：

| 禁止用法                         | 原因                              |
|----------------------------------|-----------------------------------|
| `text-red-500` / `text-red-600` / `text-red-400` | 破坏语义化主题系统              |
| `bg-orange-500` / `bg-yellow-500`（硬编码） | 无法随主题切换                    |
| 内联 style 颜色（如 `style={{ color: 'var(...)' }}`） | 绕过 CSS 变量体系              |
| `text-green-500` / `bg-green-500` | 应使用 `text-success` 等语义化 token |
| 硬编码十六进制颜色用于 UI 元素 | 所有颜色必须通过 CSS 变量引用     |
| 在 `.tsx` 中写 `class="text-[#xxx]"` | Tailwind 的 arbitrary value 在必要时使用，但优先级低于 token |

---

## 9. 推荐模式（Must Use）

| 场景                 | 推荐写法                                        |
|----------------------|-----------------------------------------------|
| 错误/危险操作         | `text-destructive` / `bg-destructive/10` / `border-destructive/20` |
| 警告状态             | `text-warning` / `bg-warning/15` / `border-warning/30` |
| 成功状态             | `text-success`                                |
| 默认链接颜色         | `text-brand-blue`（hover 时变为 `text-brand-orange`） |
| 品牌装饰/高亮        | `text-brand-orange` / `bg-brand-orange` / `bg-brand-orange-light` |
| 背景色               | `bg-background` / `bg-card` / `bg-secondary`  |
| 文字色               | `text-foreground` / `text-muted-foreground`   |
| 边框色               | `border-border` / `border-input`               |
| 焦点环               | `focus-visible:ring-ring`                      |

---

## 10. 组件使用规范

### Button

```tsx
// 主要按钮（深紫灰背景 + 白色文字）
<Button className="bg-primary text-primary-foreground hover:opacity-90">
  主要操作
</Button>

// 次要按钮（浅灰背景）
<Button variant="secondary" className="bg-secondary text-foreground">
  次要操作
</Button>

// 危险按钮
<Button variant="destructive" className="bg-destructive text-white">
  删除
</Button>

// Ghost 按钮（透明背景）
<Button variant="ghost" className="text-foreground">
  Ghost
</Button>

// 链接按钮
<Button variant="link" className="text-brand-blue hover:text-brand-orange">
  链接
</Button>
```

### Card

```tsx
// 基础卡片（背景为 --card，阴影为 --shadow-md）
<Card className="rounded-lg shadow-token-md">
  <CardHeader>标题</CardHeader>
  <CardContent>内容</CardContent>
  <CardFooter>底部操作</CardFooter>
</Card>
```

### Badge

```tsx
// 默认 Badge（6px 圆角，浅灰背景）
<Badge className="bg-secondary text-muted-foreground rounded-sm">
  Default
</Badge>

// 成功 Badge
<Badge className="bg-success/10 text-success rounded-sm">
  成功
</Badge>

// 警告 Badge
<Badge className="bg-warning/15 text-warning rounded-sm">
  警告
</Badge>

// 危险 Badge
<Badge className="bg-destructive/10 text-destructive rounded-sm">
  错误
</Badge>
```

### Input

```tsx
// 基础输入框（8px 圆角，浅灰边框）
<Input className="rounded-md border border-input bg-background" />

// 焦点状态（自动应用 --ring 焦点环）
<Input className="focus-visible:ring-2 focus-visible:ring-ring" />
```

### Dialog

```tsx
// 对话框（14px 圆角，shadow-token-xl，z-index: --z-modal）
<Dialog className="rounded-xl shadow-token-xl z-modal">
  <DialogHeader>标题</DialogHeader>
  <DialogContent>内容</DialogContent>
  <DialogFooter>操作</DialogFooter>
</Dialog>
```

### Chat 气泡

```tsx
// 消息气泡（18px 圆角）
<div className="rounded-bubble bg-secondary text-foreground">
  消息内容
</div>
```
