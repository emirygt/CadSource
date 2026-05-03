import client from './client'

export interface Mold {
  id: number
  numara: string
  tip: string | null
  lokasyon: string | null
  durum: string
  revizyon_no: string
  acilis_tarihi: string | null
  son_kullanim: string | null
  acilis_maliyeti: number | null
  tedarikci: string | null
  notlar: string | null
  olusturulma: string
}

export interface MoldIn {
  numara: string
  tip?: string
  lokasyon?: string
  durum?: string
  revizyon_no?: string
  acilis_tarihi?: string | null
  son_kullanim?: string | null
  acilis_maliyeti?: number | null
  tedarikci?: string
  notlar?: string
}

export const getMolds = async (params?: Record<string, string | number>) => {
  const res = await client.get('/molds', { params })
  return res.data as { total: number; items: Mold[] }
}

export const createMold = async (data: MoldIn): Promise<Mold> => {
  const res = await client.post('/molds', data)
  return res.data
}

export const updateMold = async (id: number, data: MoldIn): Promise<Mold> => {
  const res = await client.put(`/molds/${id}`, data)
  return res.data
}

export const deleteMold = async (id: number) => {
  await client.delete(`/molds/${id}`)
}
