import client from './client'

export interface TalepItem {
  id: number
  baslik: string
  aciklama: string | null
  talep_tipi: string | null
  oncelik: string
  durum: string
  talep_eden: string | null
  atanan: string | null
  son_tarih: string | null
  notlar: string | null
  olusturulma: string | null
  guncelleme: string | null
}

export interface TalepIn {
  baslik: string
  aciklama: string | null
  talep_tipi: string | null
  oncelik: string
  durum: string
  talep_eden: string | null
  atanan: string | null
  son_tarih: string | null
  notlar: string | null
}

export const getTalepler = (params?: Record<string, string | number>) =>
  client.get<{ items: TalepItem[]; total: number }>('/requests', { params }).then((r) => r.data)

export const createTalep = (data: TalepIn) =>
  client.post<TalepItem>('/requests', data).then((r) => r.data)

export const updateTalep = (id: number, data: TalepIn) =>
  client.put<TalepItem>(`/requests/${id}`, data).then((r) => r.data)

export const deleteTalep = (id: number) =>
  client.delete(`/requests/${id}`)
