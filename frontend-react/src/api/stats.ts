import client from './client'

export interface Stats {
  total_files: number
  indexed_files: number
  formats: Record<string, number>
  ready: boolean
}

export interface HistoryItem {
  id: number
  filename: string
  result_count: number
  top_score: number | null
  created_at: string
}

export const getStats = async (): Promise<Stats> => {
  const res = await client.get('/stats')
  return res.data
}

export const getHistory = async (limit = 10): Promise<HistoryItem[]> => {
  const res = await client.get(`/history?limit=${limit}`)
  return res.data
}
