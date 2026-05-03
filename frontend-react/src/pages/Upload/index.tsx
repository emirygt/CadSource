import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadFiles } from '@/api/library'

export default function UploadPage() {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState<{ indexed: number; skipped: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => uploadFiles(files, setProgress),
    onSuccess: (data) => {
      setDone({ indexed: data.indexed ?? data.length ?? files.length, skipped: data.skipped ?? 0 })
      setFiles([])
      setProgress(0)
      qc.invalidateQueries({ queryKey: ['files'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter((f) => f.name.match(/\.(dwg|dxf)$/i))
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...valid.filter((f) => !names.has(f.name))]
    })
    setDone(null)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-400'
        }`}
      >
        <div className="text-4xl text-slate-300">⬆</div>
        <div className="text-sm font-semibold text-slate-600">DWG / DXF dosyalarını sürükleyin</div>
        <div className="text-xs text-slate-400">veya tıklayarak seçin</div>
        <input ref={inputRef} type="file" multiple accept=".dwg,.dxf" className="hidden"
          onChange={(e) => addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <span className="text-xs font-semibold text-slate-600">{files.length} dosya seçildi</span>
            <button onClick={() => setFiles([])} className="text-xs text-slate-400 hover:text-red-500 transition-colors">Temizle</button>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {files.map((f) => (
              <div key={f.name} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-brand-600 uppercase shrink-0">{f.name.split('.').pop()}</span>
                  <span className="text-xs text-slate-700 truncate">{f.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => setFiles((p) => p.filter((x) => x.name !== f.name))}
                    className="text-slate-300 hover:text-red-400 text-sm leading-none">×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isPending && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2">
          <div className="text-xs text-slate-600 font-medium">Yükleniyor ve indeksleniyor...</div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-slate-400">%{progress}</div>
        </div>
      )}

      {done && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700 font-medium">
          ✓ {done.indexed} dosya indekslendi{done.skipped > 0 ? ` · ${done.skipped} atlandı (mükerrer)` : ''}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-600">
          {(error as any)?.response?.data?.detail ?? 'Yükleme başarısız'}
        </div>
      )}

      {files.length > 0 && !isPending && (
        <button onClick={() => mutate()}
          className="bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm px-6 py-2.5 rounded-xl transition-colors self-start">
          {files.length} Dosyayı Yükle & İndeksle
        </button>
      )}
    </div>
  )
}
