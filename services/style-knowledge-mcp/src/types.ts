/**
 * StyleKnowledge — Qdrant payload 完整类型定义
 */
export interface StyleKnowledge {
  // ── 标识 ──
  style_name: string;
  aliases: string[];

  // ── 视觉特征 ──
  visual_description: string;
  rich_text: string;
  palette: string[];
  silhouette: string[];
  fabric: string[];
  details: string[];
  reference_brands: string[];

  // ── 分类 ──
  category: string;
  season_relevance: string[];
  gender: string;

  // ── 来源 ──
  source: string;
  source_url: string;
  source_title: string;

  // ── 元数据 ──
  created_at: string;
  updated_at: string;
  confidence: number;
  popularity_score: number;
}

/** add_style / batch_import 的输入类型 */
export interface AddStyleInput {
  style_name: string;
  aliases: string[];
  visual_description: string;
  palette?: string[];
  silhouette?: string[];
  fabric?: string[];
  details?: string[];
  reference_brands?: string[];
  category?: string;
  season_relevance?: string[];
  gender?: string;
  source?: string;
  source_url?: string;
  source_title?: string;
  confidence?: number;
  popularity_score?: number;
}

/** search_style 的返回结果条目 */
export interface SearchResultItem extends StyleKnowledge {
  match_type: "name_exact" | "alias_exact" | "semantic";
  score?: number;
}

/** search_style 的完整返回 */
export interface SearchResult {
  results: SearchResultItem[];
  total: number;
  fallback_suggestion: string | null;
}

/** list_styles 返回的简化条目 */
export interface ListStyleItem {
  style_name: string;
  aliases: string[];
  category: string;
  confidence: number;
  updated_at: string;
}

/** list_styles 的完整返回 */
export interface ListResult {
  styles: ListStyleItem[];
  total: number;
}
