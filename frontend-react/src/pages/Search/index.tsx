import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { searchByFile, type SearchParams } from '@/api/search'
import type { SearchResult } from '@/types'
import UploadZone from './UploadZone'
import SearchControls from './SearchControls'
import ResultCard from './ResultCard'
import CompareToast from './CompareToast'

export default function SearchPage() {
  const [file, setFile] = useState<File | null>(null)
  const [topK, setTopK] = useState(10)
  const [minSim, setMinSim] = useState(70)
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [results, setResults] = useState<SearchResult | null>(null)
  const [sort, setSort] = useState<'similarity' | 'entity_count' | 'layer_count'>('similarity')

  const { mutate: doSearch, isPending } = useMutation({
    mutationFn: (params: SearchParams) => searchByFile(file!, params),
    onSuccess: (data) => setResults(data),
  })

  function handleSearch() {
    if (!file) return
    doSearch({ topK, minSimilarity: minSim, categoryId })
  }

  const sorted = [...(results?.results ?? [])].sort((a, b) => {
    if (sort === 'entity_count') return (b.entity_count ?? 0) - (a.entity_count ?? 0)
    if (sort === 'layer_count')  return (b.layer_count  ?? 0) - (a.layer_count  ?? 0)
    return (b.similarity ?? 0) - (a.similarity ?? 0)
  })

  return (
    <div className="flex gap-5 h-full min-h-0">
      {/* Left panel */}
      <aside className="w-64 shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
            Dosya Seç
          </div>
          <UploadZone file={file} onFile={setFile} onClear={() => { setFile(null); setResults(null) }} />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
            Arama Parametreleri
          </div>
          <SearchControls
            topK={topK} minSim={minSim} categoryId={categoryId}
            onTopK={setTopK} onMinSim={setMinSim} onCategory={setCategoryId}
            onSearch={handleSearch} loading={isPending} hasFile={!!file}
          />
        </div>
      </aside>

      {/* Right panel */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {!results && !isPending && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="text-5xl">⌕</div>
            <div className="text-sm">Soldaki panelden dosya yükleyin ve arama başlatın</div>
          </div>
        )}

        {isPending && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm">{file?.name} analiz ediliyor...</div>
          </div>
        )}

        {results && !isPending && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
              <div className="text-sm font-bold text-slate-800">
                {sorted.length} sonuç
                <span className="text-slate-400 font-normal ml-2">· %{minSim}+ eşik · {file?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Sırala:</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="similarity">Benzerlik</option>
                  <option value="entity_count">Entity sayısı</option>
                  <option value="layer_count">Katman sayısı</option>
                </select>
                <button
                  onClick={() => setResults(null)}
                  className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 hover:border-slate-400 transition-colors"
                >
                  ← Yeni Arama
                </button>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                <div className="text-3xl">○</div>
                <div className="text-sm">Sonuç bulunamadı — eşiği düşürüp tekrar deneyin</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto pb-4">
                {sorted.map((r, i) => (
                  <ResultCard key={r.id} result={r} rank={i + 1} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <CompareToast />
    </div>
  )
}
