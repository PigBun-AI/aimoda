/**
 * get_upload_spec — 返回打包规范文档
 */

import { z } from "zod";

export const getUploadSpecSchema = {};

export async function getUploadSpec() {
  const spec = `# 灵感情报站图集打包规范

## 目录结构

\`\`\`
gallery-{slug}/
├── manifest.json         ← 必须: 图集元数据
├── 01-cover.jpg          ← 图片按数字前缀排序
├── 02-detail.jpg
├── 03-street-look.jpg
└── ...
\`\`\`

## manifest.json 格式

\`\`\`json
{
  "title": "2025 SS 都市游牧风趋势",
  "description": "本季都市游牧风的核心视觉特征延续了 SS24 的探索精神...",
  "tags": ["urban-nomad", "streetwear", "ss25"],
  "category": "trend",
  "source": "vogue",
  "cover_index": 0,
  "images": [
    { "filename": "01-cover.jpg", "caption": "标志性层叠搭配" },
    { "filename": "02-detail.jpg", "caption": "面料细节特写" },
    { "filename": "03-street-look.jpg" }
  ]
}
\`\`\`

## 字段说明

### 必填字段
- **title**: 图集标题（中文或英文）
- **images**: 图片列表（filename 必须与目录中的文件名匹配）

### 可选字段
- **description**: 图集描述（富文本或纯文本）
- **tags**: 标签数组（小写英文，用连字符连接多词）
- **category**: 分类，枚举值:
  - \`trend\` — 趋势分析
  - \`collection\` — 品牌系列
  - \`street_style\` — 街拍精选
  - \`editorial\` — 编辑精选
  - \`inspiration\` — 灵感板（默认）
- **source**: 来源（如 vogue, pinterest, xiaohongshu, manual）
- **cover_index**: 封面图在 images 数组中的索引（默认 0）

### 图片要求
- 支持格式: JPEG, PNG, WebP
- 文件名以数字前缀排序: 01-, 02-, 03-, ...
- 建议分辨率: 最短边 ≥ 800px
- 单张大小限制: 10MB

## 上传流程

1. 调用 \`create_gallery\` 创建图集 → 获得 gallery_id
2. 调用 \`add_images\` 上传图片（支持 base64 或 URL）
3. 或使用 REST 端点 \`POST /upload\` 批量上传

## 标签建议

推荐使用以下标签维度:
- 风格: minimalist, maximalist, quiet-luxury, streetwear, romantic, gothic...
- 季节: ss25, fw25, resort25, pre-fall25...
- 场景: runway, street, editorial, lookbook...
- 品牌: 具体品牌名小写`;

  return {
    content: [{ type: "text" as const, text: spec }],
  };
}
