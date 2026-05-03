import { useState, type FormEvent } from 'react'
import type { Mold, MoldIn } from '@/api/molds'

const TIP_OPTS   = ['Ekstrüzyon', 'Enjeksiyon', 'Diğer']
const DURUM_OPTS = ['Aktif', 'Pasif', 'Revizyonda', 'Hurda', 'Kayıp']

interface Props {
  initial?: Mold
  loading: boolean
  error: string
  onSubmit: (data: MoldIn) => void
  onCancel: () => void
}

export default function MoldForm({ initial, loading, error, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<MoldIn>({
    numara:          initial?.numara          ?? '',
    tip:             initial?.tip             ?? '',
    lokasyon:        initial?.lokasyon        ?? '',
    durum:           initial?.durum           ?? 'Aktif',
    revizyon_no:     initial?.revizyon_no     ?? 'R0',
    acilis_tarihi:   initial?.acilis_tarihi   ?? null,
    son_kullanim:    initial?.son_kullanim    ?? null,
    acilis_maliyeti: initial?.acilis_maliyeti ?? null,
    tedarikci:       initial?.tedarikci       ?? '',
    notlar:          initial?.notlar          ?? '',
  })

  function set<K extends keyof MoldIn>(k: K, v: MoldIn[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }

  const field = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full'

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form) }} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Kalıp Numarası *</label>
          <input value={form.numara} onChange={(e) => set('numara', e.target.value)} required placeholder="KLP-8812" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tip</label>
          <select value={form.tip ?? ''} onChange={(e) => set('tip', e.target.value)} className={field}>
            <option value="">Seçiniz</option>
            {TIP_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Lokasyon</label>
          <input value={form.lokasyon ?? ''} onChange={(e) => set('lokasyon', e.target.value)} placeholder="Depo A" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Durum</label>
          <select value={form.durum ?? 'Aktif'} onChange={(e) => set('durum', e.target.value)} className={field}>
            {DURUM_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Revizyon No</label>
          <input value={form.revizyon_no ?? 'R0'} onChange={(e) => set('revizyon_no', e.target.value)} placeholder="R0" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Açılış Tarihi</label>
          <input type="date" value={form.acilis_tarihi ?? ''} onChange={(e) => set('acilis_tarihi', e.target.value || null)} className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Açılış Maliyeti (€)</label>
          <input type="number" step="0.01" min="0" value={form.acilis_maliyeti ?? ''} onChange={(e) => set('acilis_maliyeti', e.target.value ? Number(e.target.value) : null)} className={field} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tedarikçi</label>
        <input value={form.tedarikci ?? ''} onChange={(e) => set('tedarikci', e.target.value)} placeholder="Tedarikçi adı" className={field} />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notlar</label>
        <textarea value={form.notlar ?? ''} onChange={(e) => set('notlar', e.target.value)} rows={3} className={`${field} resize-none`} />
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading || !form.numara} className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {loading ? '...' : initial ? 'Güncelle' : 'Kaydet'}
        </button>
        <button type="button" onClick={onCancel} className="border border-slate-200 text-slate-600 text-sm px-5 py-2 rounded-lg hover:border-slate-400 transition-colors">
          İptal
        </button>
      </div>
    </form>
  )
}
