# Fashion Report Frontend UI Baseline

## Intent

将默认前端基线重定为“13 寸笔记本优先的紧凑型 product UI”。除少量 editorial 首屏例外外，所有产品页都应在 MacBook Air / 13–14 寸笔记本、100%–110% 浏览器缩放下保持紧凑、稳定、不过度留白。

## Design Direction

- Tone: quiet editorial, monochrome-first, structured, high-contrast
- Default density: `compact`
- Product priority: information density and task efficiency come before decorative breathing room
- Accent usage: one muted accent per view at most; black/white/neutral is the default
- Motion: subtle and optional; interaction feedback uses opacity/transform only

## Viewport And Canvas

- Primary reference device: 13-inch laptop / MacBook Air
- Compact desktop band: `1024px-1279px`
- Compact desktop rule: this range is not treated as a fully expanded desktop canvas
- Wide desktop band: `>=1280px`
- Mobile reference width: `390px`
- Standard responsive breakpoints:
  - `sm`: `640px`
  - `md`: `768px`
  - `lg`: `1024px`
  - `xl`: `1280px`
  - `2xl`: `1536px`

## Page Shells

Only use these shell types:

1. Standard product page
   - Used for list, dashboard, settings, and admin-style pages
   - Outer gutter: `16 / 20 / 24 / 32px`
   - Inner width: `max-w-6xl`
   - Vertical rhythm: `16 / 20 / 24px`
   - Default shell density: `compact`
2. Full-height app workspace
   - Used for chat, collections, profile workbench, and immersive tools
   - Must inherit available height from the shell; avoid nested `h-dvh`
   - On compact desktop, side panels should overlay instead of permanently shrinking content
3. Editorial exception surface
   - Allowed only for `cover`, `report detail` first screen, and `inspiration gallery detail` first screen
   - May use larger page titles and more generous composition
   - Must still respect the `xl` split-layout threshold

## Shared Layout Rules

- `PageFrame` defaults to `density="compact"`
- `PageIntro` defaults to `variant="compact"`
- `SectionIntro` defaults to `variant="compact"`
- Shared intro/header two-column layouts begin at `xl`, not `lg`
- App sidebar pins at `>=1280px`; `1024px-1279px` uses overlay/drawer behavior
- Editorial pages must opt into `variant="editorial"` explicitly; do not recreate the old relaxed baseline with page-local overrides

## Spacing Rhythm

Use a 4px base grid, but keep authored spacing on these rails:

- Micro: `4`, `8`
- Dense gap: `12`, `16`
- Section gap: `16`, `20`, `24`
- Major gap: `24`, `32`

Avoid one-off spacing values unless there is a content constraint.

## Typography

### Type roles

- Display / editorial title: hero and page titles only
- Section title: card and section headings
- Label / meta: navigation, pills, dense UI metadata
- Body: descriptive copy, settings, empty states
- Data: timestamps, counters, tabular values

### Size guidance

- Small label / kicker: `12px`
- Meta / dense UI: `12-13px`
- Body: `15px`
- Section title: responsive `22-32px`
- Page title: responsive `36-56px`

### Rules

- Default body copy stays at `15px`
- Keep uppercase usage to labels and navigation only
- Avoid page-local tracking overrides
- Use `text-balance` for headings and `text-pretty` for descriptive paragraphs
- Use `tabular-nums` for dates, counters, and pagination
- Tighten containers and surrounding whitespace before shrinking body copy

## Controls

- Small control height: `36px`
- Default control height: `40px`
- Large control height: `44px`
- Icon-only controls must have an `aria-label`
- Prefer shared `Button`, `Input`, `Dialog`, `Select`, and `Badge` primitives before page-local styling

## Surfaces

- Corners: square (`radius = 0`)
- Border: use theme border tokens before custom alpha tweaks
- Shadow usage:
  - `shadow-token-sm`: passive card lift
  - `shadow-token-md`: active or featured surfaces
  - `shadow-token-lg/xl`: dialogs and overlays only

## Product Page Policy

The following surfaces should follow the compact baseline by default:

- chat
- reports list
- profile / membership / collections
- admin workbench pages
- auth pages and auth dialogs
- inspiration list

These surfaces optimize for first-screen information density and reduced gutter waste on compact desktop.

## Editorial Exceptions

Only these surfaces may keep a stronger editorial feel:

- `cover`
- `report detail` first-screen title zone
- `inspiration gallery detail` first-screen visual zone

Even on these pages:

- `xl` is the first true split-layout breakpoint
- product/action areas must stay compact
- editorial breathing room must not push core content into a cramped narrow column on 13-inch laptops

## Animation Rules

- Interaction feedback max duration: `150ms`
- Entrance motion max duration: `300ms`
- Animate only `opacity` and `transform`
- Do not animate `width`, `height`, `top`, `left`, `margin`, or `padding`
- Respect `prefers-reduced-motion`
