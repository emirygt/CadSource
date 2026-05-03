import { useState, type FormEvent } from 'react'
import type { Product, ProductIn } from '@/api/products'
import type { Category } from '@/types'

const SISTEM_OPTS = ['Pencere', 'Sürme', 'Cephe', 'Kapı', 'Diğer']
const ALT_OPTS    = ['Kasa', 'Kanat', 'Eşik', 'Conta', 'Aksesuar', 'Diğer']
const MALZEME_OPTS = ['Alüminyum 6063', 'Alüminyum 6061', 'EPDM', 'PVC', 'Çelik', 'Diğer']
const DURUM_OPTS   = ['Aktif', 'Onay Bekliyor', 'Pasif', 'Arşiv']

interface Props {
  initial?: Product
  categories: Category[]
  loading: boolean
  error: string
  onSubmit: (data: ProductIn) => void
  onCancel: () => void
}

export default function ProductForm({ initial, categories, loading, error, onSubmit, onCancel }: Props) {
  const roots = categories.filter((c) => c.parent_id === null)

  const [form, setForm] = useState<ProductIn>({
    kod:           initial?.kod           ?? '',
    ad:            initial?.ad            ?? '',
    kategori_id:   initial?.kategori_id   ?? null,
    seri:          initial?.seri          ?? '',
    sistem_ailesi: initial?.sistem_ailesi ?? '',
    alt_fonksiyon: initial?.alt_fonksiyon ?? '',
    en:            initial?.en            ?? null,
    yukseklik:     initial?.yukseklik     ?? null,
    et_kalinligi:  initial?.et_kalinligi  ?? null,
    agirlik_m:     initial?.agirlik_m     ?? null,
    malzeme:       initial?.malzeme       ?? '',
    durum:         initial?.durum         ?? 'Aktif',
    etiketler:     initial?.etiketler     ?? [],
    aciklama:      initial?.aciklama      ?? '',
  })

  const [tagInput, setTagInput] = useState('')

  function set<K extends keyof ProductIn>(k: K, v: ProductIn[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !form.etiketler?.includes(t)) {
      set('etiketler', [...(form.etiketler ?? []), t])
    }
    setTagInput('')
  }

  function removeTag(t: string) {
    set('etiketler', (form.etiketler ?? []).filter((x) => x !== t))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit(form)
  }

  const field = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Zorunlu alanlar */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Ürün Kodu *</label>
          <input value={form.kod} onChange={(e) => set('kod', e.target.value)} required placeholder="ALM-5050-WIN-V1" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Ad *</label>
          <input value={form.ad} onChange={(e) => set('ad', e.target.value)} required placeholder="Pencere Kasa Profili" className={field} />
        </div>
      </div>

      {/* Sınıflandırma */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Kategori</label>
          <select value={form.kategori_id ?? ''} onChange={(e) => set('kategori_id', e.target.value ? Number(e.target.value) : null)} className={field}>
            <option value="">Seçiniz</option>
            {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sistem Ailesi</label>
          <select value={form.sistem_ailesi ?? ''} onChange={(e) => set('sistem_ailesi', e.target.value)} className={field}>
            <option value="">Seçiniz</option>
            {SISTEM_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Alt Fonksiyon</label>
          <select value={form.alt_fonksiyon ?? ''} onChange={(e) => set('alt_fonksiyon', e.target.value)} className={field}>
            <option value="">Seçiniz</option>
            {ALT_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {/* Boyutlar */}
      <div>
        <div className="text-xs font-semibold text-slate-600 mb-2">Boyutlar (mm / kg·m⁻¹)</div>
        <div className="grid grid-cols-4 gap-3">
          {([['en', 'En'], ['yukseklik', 'Yükseklik'], ['et_kalinligi', 'Et Kalınlığı'], ['agirlik_m', 'Ağırlık (kg/m)']] as const).map(([k, lbl]) => (
            <div key={k}>
              <label className="block text-xs text-slate-500 mb-1">{lbl}</label>
              <input
                type="number" step="0.001" min="0"
                value={form[k] ?? ''}
                onChange={(e) => set(k, e.target.value ? Number(e.target.value) : null)}
                className={field}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Malzeme + Seri + Durum */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Malzeme</label>
          <select value={form.malzeme ?? ''} onChange={(e) => set('malzeme', e.target.value)} className={field}>
            <option value="">Seçiniz</option>
            {MALZEME_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Seri</label>
          <input value={form.seri ?? ''} onChange={(e) => set('seri', e.target.value)} placeholder="5050 Serisi" className={field} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Durum</label>
          <select value={form.durum ?? 'Aktif'} onChange={(e) => set('durum', e.target.value)} className={field}>
            {DURUM_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {/* Etiketler */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Etiketler</label>
        <div className="flex gap-2 mb-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="Etiket yaz + Enter"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="button" onClick={addTag} className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 hover:border-brand-400 transition-colors">Ekle</button>
        </div>
        {(form.etiketler ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(form.etiketler ?? []).map((t) => (
              <span key={t} className="flex items-center gap-1 bg-brand-50 text-brand-600 border border-brand-200 text-xs px-2 py-0.5 rounded-full">
                {t}
                <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500 leading-none">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Açıklama */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Açıklama</label>
        <textarea
          value={form.aciklama ?? ''}
          onChange={(e) => set('aciklama', e.target.value)}
          rows={3}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading || !form.kod || !form.ad} className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {loading ? '...' : initial ? 'Güncelle' : 'Kaydet'}
        </button>
        <button type="button" onClick={onCancel} className="border border-slate-200 text-slate-600 text-sm px-5 py-2 rounded-lg hover:border-slate-400 transition-colors">
          İptal
        </button>
      </div>
    </form>
  )
}
