import { useQuery } from '@tanstack/react-query'
import { getStats } from '@/api/stats'
import { getCategories } from '@/api/categories'

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{label}</div>
      <div className={`text-3xl font-black ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['stats'], queryFn: getStats })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  const indexPct = stats ? Math.round((stats.indexed_files / (stats.total_files || 1)) * 100) : 0
  const topFormat = stats
    ? Object.entries(stats.formats).sort((a, b) => b[1] - a[1])[0]
    : null

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Toplam Dosya"
          value={stats?.total_files ?? '—'}
          sub="veritabanında kayıtlı"
          color="text-slate-800"
        />
        <StatCard
          label="İndekslenmiş"
          value={stats ? `%${indexPct}` : '—'}
          sub={stats ? `${stats.indexed_files} / ${stats.total_files} dosya` : ''}
          color="text-brand-500"
        />
        <StatCard
          label="Kategoriler"
          value={categories.filter((c) => c.parent_id === null).length}
          sub={`${categories.length} toplam (alt dahil)`}
          color="text-purple-600"
        />
        <StatCard
          label="Baskın Format"
          value={topFormat ? topFormat[0].toUpperCase() : '—'}
          sub={topFormat ? `${topFormat[1]} dosya` : ''}
          color="text-emerald-600"
        />
      </div>

      {/* Format dağılımı */}
      {stats && Object.keys(stats.formats).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-sm font-bold text-slate-700 mb-4">Format Dağılımı</div>
          <div className="flex flex-col gap-3">
            {Object.entries(stats.formats)
              .sort((a, b) => b[1] - a[1])
              .map(([fmt, count]) => {
                const pct = Math.round((count / (stats.total_files || 1)) * 100)
                return (
                  <div key={fmt} className="flex items-center gap-3">
                    <div className="w-10 text-xs font-bold text-slate-600 uppercase">{fmt}</div>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 w-16 text-right">{count} dosya · %{pct}</div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* İndeksleme durumu */}
      {stats && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-sm font-bold text-slate-700 mb-3">İndeksleme Durumu</div>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${indexPct}%` }}
              />
            </div>
            <div className="text-sm font-semibold text-slate-700">%{indexPct}</div>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {stats.indexed_files} dosya arama için hazır · {stats.total_files - stats.indexed_files} dosya bekliyor
          </div>
        </div>
      )}

      {/* Kategori listesi */}
      {categories.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-sm font-bold text-slate-700 mb-4">Kategoriler</div>
          <div className="grid grid-cols-2 gap-2">
            {categories
              .filter((c) => c.parent_id === null)
              .map((c) => (
                <div key={c.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-xs font-medium text-slate-700 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-slate-400">{c.file_count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {statsLoading && (
        <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Yükleniyor...</div>
      )}
    </div>
  )
}
