import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDecisions, deleteDecision } from '@/api/decisions'

const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  usable:     { label: 'Kullanılabilir',    cls: 'bg-green-100 text-green-700' },
  substitute: { label: 'Muadil',            cls: 'bg-blue-100 text-blue-700' },
  reject:     { label: 'Reddedildi',        cls: 'bg-red-100 text-red-700' },
  new_mold:   { label: 'Yeni Kalıp',        cls: 'bg-orange-100 text-orange-700' },
  revision:   { label: 'Revizyon',          cls: 'bg-purple-100 text-purple-700' },
}

function badge(type: string) {
  return TYPE_LABELS[type] ?? { label: type, cls: 'bg-slate-100 text-slate-600' }
}

export default function DecisionsPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['decisions', filter],
    queryFn: () => getDecisions(filter ? { decision_type: filter } : undefined),
  })

  const deleteMut = useMutation({
    mutationFn: deleteDecision,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['decisions'] }); setDeletingId(null) },
  })

  const items = data?.items ?? []
  const FILTERS = [
    { value: '',           label: 'Tümü' },
    { value: 'usable',     label: 'Kullanılabilir' },
    { value: 'substitute', label: 'Muadil' },
    { value: 'reject',     label: 'Reddedildi' },
    { value: 'new_mold',   label: 'Yeni Kalıp' },
  ]

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f.value
                ? 'bg-brand-500 text-white border-brand-500'
                : 'border-slate-200 text-slate-600 hover:border-brand-400'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto text-xs text-slate-400 self-center">
          {data?.total ?? 0} karar
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Yükleniyor...</div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <div className="text-2xl">✓</div>
            <div className="text-sm">Henüz karar kaydı yok</div>
          </div>
        )}

        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Referans Dosya</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Karşılaştırılan</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Benzerlik</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Karar</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Tarih</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((d) => {
                const b = badge(d.decision_type)
                const isDeleting = deletingId === d.id
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[180px] truncate">
                      {d.reference_filename}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate">
                      {d.compared_filename}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {d.similarity_score != null ? `%${Math.round(Number(d.similarity_score))}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${b.cls}`}>
                        {b.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {d.created_at
                        ? new Date(d.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDeleting ? (
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <button onClick={() => deleteMut.mutate(d.id)} className="text-red-600 font-bold hover:underline">Evet</button>
                          <button onClick={() => setDeletingId(null)} className="text-slate-500 hover:underline">İptal</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(d.id)}
                          className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                        >
                          Sil
                        </button>
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
