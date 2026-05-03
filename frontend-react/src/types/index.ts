export interface User {
  id: number
  email: string
  schema_name: string
  role?: string
}

export interface AuthState {
  token: string | null
  user: User | null
}

export interface Category {
  id: number
  name: string
  parent_id: number | null
  color: string
  file_count: number
  created_at: string
}

export interface CadFile {
  id: number
  filename: string
  file_format: string
  category_id: number | null
  category_name?: string
  uploaded_at: string
  file_size?: number
  entity_count?: number
  layer_count?: number
  bbox_width?: number
  bbox_height?: number
  bbox_area?: number
  jpg_preview?: string
  similarity?: number
  visual_similarity?: number
  clip_similarity?: number
  index_status?: string
}

export interface SearchResult {
  results: CadFile[]
  query_stats?: Record<string, unknown>
  query_preview?: string
  total?: number
}

export interface Decision {
  id: number
  reference_filename: string
  compared_file_id?: number
  compared_filename: string
  similarity_score?: number
  decision_type: string
  decision_label?: string
  notes?: string
  decided_by?: string
  created_at: string   // mapped from decided_at on backend
}
