import { useState, type FormEvent } from 'react'
import type { TalepItem, TalepIn } from '@/api/requests'

const TIP_OPTS     = ['Yeni Ürün', 'Revizyon', 'Düzeltme', 'Kalıp', 'Diğer']
const ONCELIK_OPTS = ['Yüksek', 'Orta', 'Düşük']
const DURUM_OPTS   = ['Açık', 'İnceleniyor', 'Tamamlandı', 'Reddedildi']

interface Props {
  initial?: TalepItem
  loading: boolean
  error: string
  onSubmit: (data: TalepIn) => void
  onCancel: () => void
}

export default function RequestForm({ initial, loading, error, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<TalepIn>({
    baslik:     initial?.baslik     ?? '',
    aciklama:   initial?.aciklama   ?? null,
    talep_tipi: initial?.talep_tipi ?? null,
    oncelik:    initial?.oncelik    ?? 'Orta',
    durum:      initial?.durum      ?? 'Açık',
    talep_eden: initial?.talep_eden ?? null,
    atanan:     initial?.atanan     ?? null,
    son_tarih:  initial?.son_tarih  ?? null,
    notlar:     initial?.notlar     ?? null,
  })

  function set<K extends keyof TalepIn>(k: K, v: TalepIn[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }

  const field = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full'

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form) }} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Başlık *</label>
        <input value={form.baslik} onChange={(e) => set('baslik', e.target.value)} required placeholder="Talep başlığı" className={field} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tip</label>
          <select value={form.talep_tipi ?? ''} onChange={(e) => set('talep_tipi', e.target.value || null)} className={field}>
            <option value="">Seçiniz</option>
            {TIP_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Öncelik</label>
          <select value={form.oncelik} onChange={(e) => set('oncelik', e.target.value)} className={field}>
            {ONCELIK_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Durum</label>
          <select value={form.durum} onChange={(e) => set('durum', e.target.value)} className={field}>
            {DURUM_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Talep Eden</label>
          <input value={form.talep_eden ?? ''} onChange={(e) => set('talep_eden', e.target.value || null)} placeholder="Ad Soyad" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Atanan</label>
          <input value={form.atanan ?? ''} onChange={(e) => set('atanan', e.target.value || null)} placeholder="Ad Soyad" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Son Tarih</label>
          <input type="date" value={form.son_tarih ?? ''} onChange={(e) => set('son_tarih', e.target.value || null)} className={field} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Açıklama</label>
        <textarea value={form.aciklama ?? ''} onChange={(e) => set('aciklama', e.target.value || null)} rows={3} className={`${field} resize-none`} />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notlar</label>
        <textarea value={form.notlar ?? ''} onChange={(e) => set('notlar', e.target.value || null)} rows={2} className={`${field} resize-none`} />
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading || !form.baslik} className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {loading ? '...' : initial ? 'Güncelle' : 'Kaydet'}
        </button>
        <button type="button" onClick={onCancel} className="border border-slate-200 text-slate-600 text-sm px-5 py-2 rounded-lg hover:border-slate-400 transition-colors">
          İptal
        </button>
      </div>
    </form>
  )
}
