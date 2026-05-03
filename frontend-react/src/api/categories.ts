import client from './client'
import type { Category } from '@/types'

export const getCategories = async (): Promise<Category[]> => {
  const res = await client.get('/categories')
  return res.data
}

export const createCategory = async (data: { name: string; color?: string }) => {
  const res = await client.post('/categories', data)
  return res.data
}

export const updateCategory = async (id: number, data: { name?: string; color?: string }) => {
  const res = await client.put(`/categories/${id}`, data)
  return res.data
}

export const deleteCategory = async (id: number) => {
  const res = await client.delete(`/categories/${id}`)
  return res.data
}
