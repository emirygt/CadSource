import type { CadFile } from '@/types'
import { useCompareStore } from '@/store/compare'
import { downloadFile } from '@/api/search'

interface Props {
  result: CadFile
  rank: number
}

function simColor(s: number) {
  return s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444'
}

function simLabel(s: number) {
  if (s >= 95) return { text: 'Tam Eşleşme', cls: 'bg-green-100 text-green-700' }
  if (s >= 80) return { text: 'Muadil',       cls: 'bg-blue-100 text-blue-700' }
  if (s >= 65) return { text: 'Benzer',        cls: 'bg-orange-100 text-orange-700' }
  return              { text: 'Revizyon Adayı', cls: 'bg-red-100 text-red-700' }
}

export default function ResultCard({ result: r, rank }: Props) {
  const { items, toggle } = useCompareStore()
  const isSelected = items.some((c) => c.id === r.id)
  const sim = Number(r.similarity ?? 0)
  const badge = simLabel(sim)

  return (
    <div
      className={`bg-white rounded-xl border transition-all ${
        isSelected ? 'border-brand-500 ring-1 ring-brand-400' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Preview */}
      <div className="relative border-b border-slate-100">
        {r.jpg_preview ? (
          <img
            src={r.jpg_preview}
            alt={r.filename}
            className="w-full h-44 object-contain p-3 bg-white"
            style={{ filter: 'contrast(1.6) brightness(1.1)' }}
          />
        ) : (
          <div className="h-44 flex items-center justify-center text-slate-300 text-xs">
            Önizleme yok
          </div>
        )}
        {/* Rank badge */}
        <div className="absolute top-2 left-2 bg-slate-800/70 text-white text-xs font-bold px-1.5 py-0.5 rounded">
          #{rank}
        </div>
        {/* Similarity badge */}
        <div className={`absolute top-2 right-2 text-xs font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>
          %{sim} · {badge.text}
        </div>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-800 truncate flex-1" title={r.filename}>
            {r.filename}
          </span>
          {r.category_name && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{ background: (r as any).category_color + '22', color: (r as any).category_color || '#6366f1' }}
            >
              {r.category_name}
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-3 text-xs text-slate-500">
          <span>{r.entity_count?.toLocaleString('tr')} entity</span>
          <span>·</span>
          <span>{r.layer_count} katman</span>
          <span>·</span>
          <span>{r.file_format?.toUpperCase()}</span>
        </div>

        {/* Sim bar */}
        <div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${sim}%`, background: simColor(sim) }}
            />
          </div>
        </div>

        {/* Dimensions */}
        {r.bbox_width && r.bbox_height && (
          <div className="text-xs text-slate-400">
            {Math.round(r.bbox_width)} × {Math.round(r.bbox_height)} mm
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 flex-wrap pt-1">
          <button
            onClick={() => toggle(r)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              isSelected
                ? 'bg-brand-500 text-white border-brand-500'
                : 'border-slate-200 text-slate-600 hover:border-brand-400 hover:text-brand-600'
            }`}
          >
            {isSelected ? '✓ Seçildi' : '+ Karşılaştır'}
          </button>
          <button
            onClick={() => downloadFile(r.id, r.filename)}
            className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors"
          >
            ↓ İndir
          </button>
        </div>
      </div>
    </div>
  )
}
