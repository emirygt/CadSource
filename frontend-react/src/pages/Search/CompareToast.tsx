import { useCompareStore } from '@/store/compare'

export default function CompareToast() {
  const { items, clear } = useCompareStore()
  if (items.length === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-xl z-50 text-sm">
      <span className="text-slate-600 font-medium">{items.length} dosya seçildi</span>
      {items.length === 2 && (
        <button className="bg-brand-500 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-brand-600 transition-colors">
          Karşılaştır →
        </button>
      )}
      <button onClick={clear} className="text-slate-400 hover:text-slate-600 text-lg leading-none">
        ×
      </button>
    </div>
  )
}
