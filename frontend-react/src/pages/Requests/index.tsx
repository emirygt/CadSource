import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTalepler, createTalep, updateTalep, deleteTalep, type TalepItem, type TalepIn } from '@/api/requests'
import RequestForm from './RequestForm'

const ONCELIK_CLS: Record<string, string> = {
  'Yüksek': 'bg-red-100 text-red-700',
  'Orta':   'bg-yellow-100 text-yellow-700',
  'Düşük':  'bg-slate-100 text-slate-500',
}

const DURUM_CLS: Record<string, string> = {
  'Açık':        'bg-blue-100 text-blue-700',
  'İnceleniyor': 'bg-yellow-100 text-yellow-700',
  'Tamamlandı':  'bg-green-100 text-green-700',
  'Reddedildi':  'bg-red-100 text-red-600',
}

export default function RequestsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [durum, setDurum] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<TalepItem | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const params: Record<string, string> = {}
  if (search) params.q = search
  if (durum)  params.durum = durum

  const { data, isLoading } = useQuery({ queryKey: ['talepler', params], queryFn: () => getTalepler(params) })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['talepler'] })

  const createMut = useMutation({ mutationFn: createTalep, onSuccess: () => { invalidate(); setShowForm(false) } })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TalepIn }) => updateTalep(id, data),
    onSuccess: () => { invalidate(); setEditing(null) },
  })
  const deleteMut = useMutation({ mutationFn: deleteTalep, onSuccess: () => { invalidate(); setDeletingId(null) } })

  const items = data?.items ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Başlık veya talep eden ara..."
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56"
        />
        <select value={durum} onChange={(e) => setDurum(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500">
          <option value="">Tüm Durumlar</option>
          {['Açık', 'İnceleniyor', 'Tamamlandı', 'Reddedildi'].map((d) => <option key={d}>{d}</option>)}
        </select>
        <div className="ml-auto text-xs text-slate-400">{data?.total ?? 0} talep</div>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors">
          + Yeni Talep
        </button>
      </div>

      {/* Form modal */}
      {(showForm || editing) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800">{editing ? 'Talebi Düzenle' : 'Yeni Talep'}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <div className="p-6">
              <RequestForm
                initial={editing ?? undefined}
                loading={createMut.isPending || updateMut.isPending}
                error={(createMut.error as any)?.response?.data?.detail || (updateMut.error as any)?.response?.data?.detail || ''}
                onSubmit={(vals) => { if (editing) updateMut.mutate({ id: editing.id, data: vals }); else createMut.mutate(vals) }}
                onCancel={() => { setShowForm(false); setEditing(null) }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading && <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Yükleniyor...</div>}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <div className="text-3xl">◈</div>
            <div className="text-sm">Henüz talep yok — sağ üstten ekleyin</div>
          </div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['Başlık', 'Tip', 'Talep Eden', 'Atanan', 'Son Tarih', 'Öncelik', 'Durum', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((t) => {
                const isDeleting = deletingId === t.id
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800 text-xs font-medium max-w-[200px] truncate">{t.baslik}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{t.talep_tipi ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{t.talep_eden ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{t.atanan ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{t.son_tarih ? new Date(t.son_tarih).toLocaleDateString('tr') : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ONCELIK_CLS[t.oncelik] ?? 'bg-slate-100 text-slate-600'}`}>{t.oncelik}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DURUM_CLS[t.durum] ?? 'bg-slate-100 text-slate-600'}`}>{t.durum}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDeleting ? (
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <span className="text-red-500 font-medium">Silinsin mi?</span>
                          <button onClick={() => deleteMut.mutate(t.id)} className="text-red-600 font-bold hover:underline">Evet</button>
                          <button onClick={() => setDeletingId(null)} className="text-slate-500 hover:underline">İptal</button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setEditing(t)} className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:border-brand-400 hover:text-brand-600 transition-colors">Düzenle</button>
                          <button onClick={() => setDeletingId(t.id)} className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500 transition-colors">Sil</button>
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
    </div>
  )
}
