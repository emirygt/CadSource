import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/api/categories'
import type { Category } from '@/types'

const COLORS = ['#6366f1','#2f66eb','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899']

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full border-2 transition-transform ${value === c ? 'border-slate-800 scale-110' : 'border-transparent'}`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

interface FormState { name: string; color: string }
const EMPTY: FormState = { name: '', color: '#6366f1' }

export default function CategoriesPage() {
  const qc = useQueryClient()
  const { data: categories = [], isLoading } = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const roots = categories.filter((c) => c.parent_id === null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] })

  const createMut = useMutation({
    mutationFn: createCategory,
    onSuccess: () => { invalidate(); setForm(EMPTY); setError('') },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Hata'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FormState }) => updateCategory(id, data),
    onSuccess: () => { invalidate(); setEditingId(null); setForm(EMPTY) },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Hata'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => { invalidate(); setDeletingId(null) },
  })

  function startEdit(c: Category) {
    setEditingId(c.id)
    setForm({ name: c.name, color: c.color })
    setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    if (editingId) {
      updateMut.mutate({ id: editingId, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  function cancelEdit() { setEditingId(null); setForm(EMPTY); setError('') }

  const busy = createMut.isPending || updateMut.isPending

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      {/* Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-4">
          {editingId ? 'Kategoriyi Düzenle' : 'Yeni Kategori'}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Kategori Adı</label>
            <input
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="örn. Pencere Sistemleri"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Renk</label>
            <ColorPicker value={form.color} onChange={(c) => setForm((s) => ({ ...s, color: c }))} />
          </div>
          {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !form.name.trim()}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {busy ? '...' : editingId ? 'Kaydet' : 'Ekle'}
            </button>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="border border-slate-200 text-slate-600 text-sm px-4 py-2 rounded-lg hover:border-slate-400 transition-colors">
                İptal
              </button>
            )}
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">Kategoriler</span>
          <span className="text-xs text-slate-400">{roots.length} kategori</span>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Yükleniyor...</div>
        )}

        {!isLoading && roots.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Henüz kategori yok</div>
        )}

        <ul className="divide-y divide-slate-50">
          {roots.map((cat) => {
            const children = categories.filter((c) => c.parent_id === cat.id)
            const isEditing = editingId === cat.id
            const isDeleting = deletingId === cat.id

            return (
              <li key={cat.id}>
                <div className={`flex items-center gap-3 px-5 py-3 ${isEditing ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{cat.name}</span>
                    {children.length > 0 && (
                      <span className="text-xs text-slate-400 ml-2">{children.length} alt kategori</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 mr-2">{cat.file_count} dosya</span>

                  {isDeleting ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-red-500 font-medium">Silinsin mi?</span>
                      <button onClick={() => deleteMut.mutate(cat.id)} className="text-red-600 font-bold hover:underline">Evet</button>
                      <button onClick={() => setDeletingId(null)} className="text-slate-500 hover:underline">İptal</button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(cat)} className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:border-brand-400 hover:text-brand-600 transition-colors">
                        Düzenle
                      </button>
                      <button onClick={() => setDeletingId(cat.id)} className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500 transition-colors">
                        Sil
                      </button>
                    </div>
                  )}
                </div>

                {/* Alt kategoriler */}
                {children.map((ch) => (
                  <div key={ch.id} className="flex items-center gap-3 px-5 py-2.5 pl-10 bg-slate-50/60 border-t border-slate-50">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ch.color }} />
                    <span className="text-xs text-slate-600 flex-1">{ch.name}</span>
                    <span className="text-xs text-slate-400">{ch.file_count} dosya</span>
                  </div>
                ))}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
