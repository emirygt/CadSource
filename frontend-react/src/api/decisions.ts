import client from './client'
import type { Decision } from '@/types'

interface DecisionListResponse {
  total: number
  items: Decision[]
}

export const getDecisions = async (params?: { decision_type?: string; limit?: number }): Promise<DecisionListResponse> => {
  const res = await client.get('/decisions', { params: { limit: 50, ...params } })
  return res.data
}

export const deleteDecision = async (id: number) => {
  const res = await client.delete(`/decisions/${id}`)
  return res.data
}
