import client from './client'

export interface Product {
  id: number
  kod: string
  ad: string
  kategori_id: number | null
  kategori_adi: string | null
  seri: string | null
  sistem_ailesi: string | null
  alt_fonksiyon: string | null
  en: number | null
  yukseklik: number | null
  et_kalinligi: number | null
  agirlik_m: number | null
  malzeme: string | null
  durum: string
  etiketler: string[]
  aciklama: string | null
  olusturan: string | null
  olusturulma: string
  guncelleme: string
}

export interface ProductIn {
  kod: string
  ad: string
  kategori_id?: number | null
  seri?: string
  sistem_ailesi?: string
  alt_fonksiyon?: string
  en?: number | null
  yukseklik?: number | null
  et_kalinligi?: number | null
  agirlik_m?: number | null
  malzeme?: string
  durum?: string
  etiketler?: string[]
  aciklama?: string
}

export const getProducts = async (params?: Record<string, string | number>) => {
  const res = await client.get('/products', { params })
  return res.data as { total: number; items: Product[] }
}

export const getProduct = async (id: number): Promise<Product> => {
  const res = await client.get(`/products/${id}`)
  return res.data
}

export const createProduct = async (data: ProductIn): Promise<Product> => {
  const res = await client.post('/products', data)
  return res.data
}

export const updateProduct = async (id: number, data: ProductIn): Promise<Product> => {
  const res = await client.put(`/products/${id}`, data)
  return res.data
}

export const deleteProduct = async (id: number) => {
  await client.delete(`/products/${id}`)
}
