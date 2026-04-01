# aimoda-style-collection-mcp

## 概述

风格知识库 MCP 服务，负责管理时尚风格的结构化知识（风格定义、视觉特征、别名映射等）。
数据存储在 Qdrant 向量数据库的 `style_knowledge` collection 中，支持精确匹配和语义搜索两种检索方式。

## Qdrant Collection 设计

### Collection: `style_knowledge`

**向量配置：**

| 向量名 | 维度 | 距离度量 | 用途 |
|--------|------|---------|------|
| `description` | 768 | Cosine | 风格视觉描述的 FashionCLIP 嵌入，用于语义搜索 |

**Payload Schema：**

```typescript
interface StyleKnowledge {
  // ── 标识 ──
  style_name: string            // 英文规范名，如 "quiet luxury"
  aliases: string[]             // 多语言别名：["老钱风", "静奢风", "old money aesthetic", "stealth wealth"]
  
  // ── 视觉特征（核心） ──
  visual_description: string    // 完整的英文视觉描述文本（也是向量化的源文本）
                                // 例: "understated elegance featuring neutral camel and ivory tones,
                                //      relaxed tailoring with no visible logos, premium cashmere and
                                //      fine-gauge knit fabrics, clean tonal buttons and minimal hardware"
  palette: string[]             // 色调关键词：["camel", "ivory", "charcoal", "navy"]
  silhouette: string[]          // 廓形关键词：["tailored", "relaxed-elegant", "unstructured"]
  fabric: string[]              // 面料关键词：["cashmere", "wool", "silk", "fine-gauge knit"]
  details: string[]             // 设计细节：["no visible logos", "tonal buttons", "clean seams"]
  reference_brands: string[]    // 代表品牌：["The Row", "Loro Piana", "Brunello Cucinelli"]
  
  // ── 分类 ──
  category: string              // 大类：例 "luxury", "streetwear", "avant-garde", "romantic", "sporty"
  season_relevance: string[]    // 适合季节：["all", "fall-winter", "spring-summer", "resort"]
  gender: string                // "women", "men", "unisex"
  
  // ── 来源 ──
  source: string                // 数据来源标识："vogue", "pinterest", "xiaohongshu", "manual"
  source_url: string            // 原始 URL
  source_title: string          // 文章/帖子标题
  
  // ── 元数据 ──
  created_at: string            // ISO 8601 格式
  updated_at: string            // ISO 8601 格式
  confidence: number            // 数据可信度 0-1（人工验证=1，自动采集=0.6-0.8）
  popularity_score: number      // 流行度评分（可从 Pinterest/小红书热度推算）
}
```

**Payload 索引（已/待创建）：**

| 字段 | 索引类型 | 用途 |
|------|---------|------|
| `style_name` | keyword | 精确匹配英文风格名 |
| `aliases` | keyword | 精确匹配别名（含中文） |
| `source` | keyword | 按来源筛选 |
| `category` | keyword | 按大类筛选 |
| `updated_at` | keyword | 按更新时间排序 |

---

## MCP 工具设计

### Qdrant 连接信息

```
URL:     http://220.168.84.134:16333
API_KEY: aimoda2025
COLLECTION: style_knowledge
```

### 向量编码

使用 FashionCLIP 编码 `visual_description` 文本为 768 维向量：

```python
from transformers import CLIPProcessor, CLIPModel

model = CLIPModel.from_pretrained("patrickjohncyh/fashion-clip")
processor = CLIPProcessor.from_pretrained("patrickjohncyh/fashion-clip")

def encode_text(text: str) -> list[float]:
    inputs = processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        emb = model.get_text_features(**inputs)
    emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb[0].tolist()
```

---

### Tool 1: `search_style`

搜索风格知识库，优先精确匹配，无结果时回退语义搜索。

```typescript
/**
 * 搜索风格知识库
 * 
 * @param query - 风格名称或描述（中/英文均可）
 *                例: "老钱风", "quiet luxury", "低调奢华感"
 * @param limit - 返回结果数量上限，默认 3
 * @returns 匹配的风格条目列表（含 visual_description、palette、fabric 等完整信息）
 * 
 * 搜索策略:
 *   1. 精确匹配 style_name 或 aliases（MatchAny）
 *   2. 若无精确匹配 → 用 query 文本编码为向量，做语义近邻搜索
 *   3. 若语义搜索 score < 0.5 → 返回空，建议触发 MCP 联网查询
 */
tool search_style(query: string, limit?: number): StyleKnowledge[]
```

**返回示例：**
```json
{
  "results": [
    {
      "style_name": "quiet luxury",
      "aliases": ["老钱风", "静奢风", "old money aesthetic"],
      "visual_description": "understated elegance featuring neutral camel and ivory tones...",
      "palette": ["camel", "ivory", "charcoal"],
      "silhouette": ["tailored", "relaxed-elegant"],
      "fabric": ["cashmere", "wool", "silk"],
      "details": ["no visible logos", "tonal buttons"],
      "reference_brands": ["The Row", "Loro Piana"],
      "confidence": 0.95,
      "match_type": "alias_exact"  // "alias_exact" | "name_exact" | "semantic"
    }
  ],
  "total": 1,
  "fallback_suggestion": null  // 若无结果: "未找到匹配风格，建议联网搜索"
}
```

---

### Tool 2: `add_style`

新增一条风格知识到库中。自动编码 visual_description 为向量。

```typescript
/**
 * 新增风格知识条目
 * 
 * @param style_name     - 英文规范名（唯一标识）
 * @param aliases        - 多语言别名列表（至少包含中文名）
 * @param visual_description - 具体的英文视觉特征描述（会被向量化）
 * @param palette        - 色调关键词列表
 * @param silhouette     - 廓形关键词列表
 * @param fabric         - 面料关键词列表
 * @param details        - 设计细节列表
 * @param reference_brands - 代表品牌列表
 * @param category       - 风格大类
 * @param source         - 数据来源 "vogue" | "pinterest" | "xiaohongshu" | "manual"
 * @param source_url     - 原始 URL
 * @param source_title   - 文章标题
 * @param confidence     - 可信度 0-1
 * @returns 创建结果（含生成的 point_id）
 * 
 * 注意:
 *   - 如果 style_name 已存在，自动合并（别名取并集，其他字段更新为最新值）
 *   - visual_description 变更时自动重新编码向量
 */
tool add_style(
  style_name: string,
  aliases: string[],
  visual_description: string,
  palette?: string[],
  silhouette?: string[],
  fabric?: string[],
  details?: string[],
  reference_brands?: string[],
  category?: string,
  source?: string,
  source_url?: string,
  source_title?: string,
  confidence?: number
): { status: string, point_id: string, merged: boolean }
```

---

### Tool 3: `update_style`

更新已有风格条目的部分字段。

```typescript
/**
 * 更新风格知识条目
 * 
 * @param style_name - 要更新的风格英文名
 * @param updates    - 要更新的字段（部分更新，未提供的字段保持不变）
 *                     aliases 支持 append 模式：新别名追加到已有列表
 * @returns 更新结果
 * 
 * 特殊行为:
 *   - 如果 visual_description 被更新，自动重新编码向量
 *   - aliases 默认追加（不覆盖），设 replace_aliases=true 可覆盖
 */
tool update_style(
  style_name: string,
  updates: Partial<StyleKnowledge>,
  replace_aliases?: boolean
): { status: string, updated_fields: string[] }
```

---

### Tool 4: `list_styles`

列出知识库中的所有风格，支持分类筛选。

```typescript
/**
 * 列出知识库中的风格条目
 * 
 * @param category - 可选，按大类筛选
 * @param source   - 可选，按来源筛选
 * @param limit    - 返回数量上限，默认 50
 * @returns 风格列表（简化版，不含 visual_description 全文）
 */
tool list_styles(
  category?: string,
  source?: string,
  limit?: number
): { 
  styles: Array<{
    style_name: string,
    aliases: string[],
    category: string,
    confidence: number,
    updated_at: string
  }>,
  total: number
}
```

---

### Tool 5: `delete_style`

删除一条风格知识。

```typescript
/**
 * 删除风格知识条目
 * 
 * @param style_name - 要删除的风格英文名
 * @returns 删除结果
 */
tool delete_style(style_name: string): { status: string, deleted: boolean }
```

---

### Tool 6: `batch_import_styles`

批量导入风格数据（用于 OpenClaw 采集后的批量入库）。

```typescript
/**
 * 批量导入风格知识
 * 
 * @param styles - 风格条目列表（格式同 add_style 参数）
 * @returns 导入统计
 * 
 * 行为:
 *   - 已存在的 style_name 自动合并
 *   - 新的 style_name 创建新条目
 *   - 所有 visual_description 自动编码为向量
 */
tool batch_import_styles(
  styles: AddStyleInput[]
): { 
  status: string,
  total: number,
  created: number,
  merged: number,
  errors: Array<{ style_name: string, error: string }>
}
```

---

## 数据流架构

```
┌─────────────────────────────────────────────────────────┐
│                     数据采集层                           │
│                                                         │
│  Vogue MCP ──┐                                          │
│  Pinterest ──┼── OpenClaw 自动化 ── batch_import_styles  │
│  小红书 MCP ──┘                                          │
│               手动录入 ──────────── add_style             │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Qdrant: style_knowledge                     │
│                                                         │
│  向量: FashionCLIP(visual_description) → 768-dim         │
│  Payload: style_name, aliases[], palette[], fabric[]...  │
│  索引: style_name, aliases, source, category             │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     消费层                               │
│                                                         │
│  fashion-report Agent:                                   │
│    1. 用户输入 "老钱风"                                    │
│    2. Agent 调 search_style("老钱风")                     │
│    3. 得到 visual_description                            │
│    4. 用 visual_description 调 start_collection(query=…) │
│    5. 精准语义检索 ✅                                      │
│                                                         │
│  VLM 打标 Pipeline:                                      │
│    1. list_styles() 获取所有风格定义                       │
│    2. 构建 prompt: "这张图属于哪些风格？"                   │
│    3. VLM 输出风格标签 → 写入图片 payload                  │
└─────────────────────────────────────────────────────────┘
```

---

## 开发优先级

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | `search_style` | 检索核心，fashion-report Agent 直接依赖 |
| P0 | `add_style` | 入库核心，手动录入 + OpenClaw 依赖 |
| P1 | `list_styles` | 管理工具，VLM 打标 pipeline 依赖 |
| P1 | `batch_import_styles` | OpenClaw 批量入库依赖 |
| P2 | `update_style` | 增量更新 |
| P2 | `delete_style` | 数据清理 |

## 技术栈

- **运行时**: Node.js / TypeScript（与其他 MCP 服务一致）
- **MCP SDK**: `@anthropic-ai/sdk` 或 `@modelcontextprotocol/sdk`
- **向量编码**: 调用 FashionCLIP 服务（可复用 fashion-report 后端的编码端点，或独立部署）
- **Qdrant**: `@qdrant/js-client-rest`

## 环境变量

```env
QDRANT_URL=http://220.168.84.134:16333
QDRANT_API_KEY=aimoda2025
QDRANT_COLLECTION=style_knowledge
FASHION_CLIP_ENDPOINT=http://localhost:18888/encode  # 可选：远程编码服务
```
