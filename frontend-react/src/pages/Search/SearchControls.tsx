import { useQuery } from '@tanstack/react-query'
import { getCategories } from '@/api/categories'

interface Props {
  topK: number
  minSim: number
  categoryId: number | undefined
  onTopK: (v: number) => void
  onMinSim: (v: number) => void
  onCategory: (id: number | undefined) => void
  onSearch: () => void
  loading: boolean
  hasFile: boolean
}

export default function SearchControls({
  topK, minSim, categoryId, onTopK, onMinSim, onCategory, onSearch, loading, hasFile,
}: Props) {
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  })

  const roots = categories.filter((c) => c.parent_id === null)

  return (
    <div className="flex flex-col gap-4">
      {/* Top K */}
      <div>
        <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1.5">
          <span>Sonuç Sayısı</span>
          <span className="text-brand-500">{topK}</span>
        </div>
        <input
          type="range" min={5} max={30} step={5} value={topK}
          onChange={(e) => onTopK(Number(e.target.value))}
          className="w-full accent-brand-500"
        />
      </div>

      {/* Min similarity */}
      <div>
        <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1.5">
          <span>Min. Benzerlik</span>
          <span className="text-brand-500">%{minSim}</span>
        </div>
        <input
          type="range" min={40} max={99} step={1} value={minSim}
          onChange={(e) => onMinSim(Number(e.target.value))}
          className="w-full accent-brand-500"
        />
      </div>

      {/* Category chips */}
      <div>
        <div className="text-xs font-semibold text-slate-600 mb-2">Kategori</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onCategory(undefined)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              categoryId === undefined
                ? 'bg-brand-500 border-brand-500 text-white'
                : 'border-slate-200 text-slate-600 hover:border-brand-400'
            }`}
          >
            Tümü
          </button>
          {roots.map((c) => (
            <button
              key={c.id}
              onClick={() => onCategory(c.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                categoryId === c.id
                  ? 'text-white border-transparent'
                  : 'text-slate-600 hover:border-brand-400 border-slate-200'
              }`}
              style={categoryId === c.id ? { background: c.color, borderColor: c.color } : {}}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Search button */}
      <button
        onClick={onSearch}
        disabled={!hasFile || loading}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
      >
        {loading ? 'Analiz ediliyor...' : 'Benzer Profil Ara'}
      </button>
    </div>
  )
}
