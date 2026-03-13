export const REPORT_SPEC = {
  version: '1.0.0',
  updatedAt: '2026-03-13',
  description: 'OpenClaw 报告生成规范 - Agent 生成前请查阅',
  folderStructure: {
    root: '品牌-季节-年份/',
    required: ['index.html', 'overview.html', 'images/'],
    optional: ['metadata.json'],
    images: {
      original: 'images/look-001.jpg ~ look-052.jpg',
      compressed: 'images/compressed/look-001-400.jpg (可选)',
      thumbnails: 'images/thumbnails/look-001-thumb.jpg (可选)'
    }
  },
  iframeRules: {
    indexHtml: {
      type: '全屏滚动报告',
      pages: '每页 100vh，CSS scroll-snap 对齐',
      structure: '7 个 section，分别展示不同风格系列',
      title: "品牌 + 季节 + 系列，如 'Zimmermann Fall 2026 RTW'"
    },
    overviewHtml: {
      type: '三栏 dashboard',
      left: '38% - 缩略图网格（按风格系列分组）',
      center: '35% - 色彩/廓形/面料统计',
      right: '27% - 雷达图 + 风格占比 + 季度总结'
    },
    cssIsolation: 'iframe 天然隔离，外层样式不影响内层',
    fonts: 'Playfair Display (标题) + Inter (正文)'
  },
  naming: {
    folder: '品牌-季节-年份（英文，中横线分隔）',
    example: 'zimmermann-fall-2026, chanel-spring-2027'
  }
} as const
