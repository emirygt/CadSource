import client from './client'
import type { CadFile } from '@/types'

export interface FileListParams {
  q?: string
  category_id?: number
  file_format?: string
  limit?: number
  offset?: number
}

export interface FileListResponse {
  items: CadFile[]
  total: number
}

export const getFiles = (params?: FileListParams) =>
  client.get<FileListResponse>('/files', { params }).then((r) => r.data)

export const deleteFile = (id: number) =>
  client.delete(`/files/${id}`)

export const uploadFiles = (files: File[], onProgress?: (pct: number) => void) => {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  return client.post('/index/bulk', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  }).then((r) => r.data)
}
