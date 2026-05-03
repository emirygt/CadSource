import client from './client'
import type { SearchResult, CadFile } from '@/types'

export interface SearchParams {
  topK: number
  minSimilarity: number
  categoryId?: number
}

export async function searchByFile(file: File, params: SearchParams): Promise<SearchResult> {
  const fd = new FormData()
  fd.append('file', file)
  const q = new URLSearchParams({
    top_k: String(params.topK),
    min_similarity: String(params.minSimilarity / 100),
    ...(params.categoryId ? { category_id: String(params.categoryId) } : {}),
  })
  const res = await client.post(`/search?${q}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function getFile(id: number): Promise<CadFile> {
  const res = await client.get(`/files/${id}`)
  return res.data
}

export async function downloadFile(id: number, filename: string) {
  const res = await client.get(`/files/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function sendFeedback(fileId: number, similarity: number, positive: boolean) {
  await client.post('/feedback', { file_id: fileId, similarity, positive })
}
