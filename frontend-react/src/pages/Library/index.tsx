import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getFiles, deleteFile } from '@/api/library'
import { getCategories } from '@/api/categories'
import { downloadFile } from '@/api/search'
import type { CadFile } from '@/types'

const FORMAT_CLS: Record<string, string> = {
  dwg: 'bg-blue-100 text-blue-700',
  dxf: 'bg-purple-100 text-purple-700',
}

export default function LibraryPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [format, setFormat] = useState('')
  const [page, setPage] = useState(0)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const limit = 50

  const params = {
    ...(search ? { q: search } : {}),
    ...(categoryId ? { category_id: Number(categoryId) } : {}),
    ...(format ? { file_format: format } : {}),
    limit,
    offset: page * limit,
  }

  const { data, isLoading } = useQuery({ queryKey: ['files', params], queryFn: () => getFiles(params) })
  const { data: cats = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteFile(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['files'] }); setDeletingId(null) },
  })

  const items: CadFile[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          placeholder="Dosya adı ara..."
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56" />
        <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value ? Number(e.target.value) : ''); setPage(0) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500">
          <option value="">Tüm Kategoriler</option>
          {cats.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={format} onChange={(e) => { setFormat(e.target.value); setPage(0) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500">
          <option value="">Tüm Formatlar</option>
          <option value="dwg">DWG</option>
          <option value="dxf">DXF</option>
        </select>
        <div className="ml-auto text-xs text-slate-400">{total} dosya</div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading && <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Yükleniyor...</div>}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <div className="text-3xl">○</div>
            <div className="text-sm">Dosya bulunamadı</div>
          </div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['Dosya Adı', 'Format', 'Kategori', 'Entity', 'Katman', 'Boyut', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((f) => {
                const isDeleting = deletingId === f.id
                return (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-800 max-w-[240px] truncate">{f.filename}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${FORMAT_CLS[f.file_format] ?? 'bg-slate-100 text-slate-600'}`}>
                        {f.file_format}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{f.category_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{f.entity_count ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{f.layer_count ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {f.bbox_area ? `${f.bbox_width?.toFixed(0)}×${f.bbox_height?.toFixed(0)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isDeleting ? (
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <span className="text-red-500 font-medium">Silinsin mi?</span>
                          <button onClick={() => deleteMut.mutate(f.id)} className="text-red-600 font-bold hover:underline">Evet</button>
                          <button onClick={() => setDeletingId(null)} className="text-slate-500 hover:underline">İptal</button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => downloadFile(f.id, f.filename)}
                            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:border-brand-400 hover:text-brand-600 transition-colors">
                            ↓ İndir
                          </button>
                          <button onClick={() => setDeletingId(f.id)}
                            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500 transition-colors">
                            Sil
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:border-brand-400 transition-colors">
            ← Önceki
          </button>
          <span className="text-xs text-slate-500">{page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:border-brand-400 transition-colors">
            Sonraki →
          </button>
        </div>
      )}
    </div>
  )
}
