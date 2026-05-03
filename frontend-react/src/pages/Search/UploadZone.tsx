import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'

interface Props {
  file: File | null
  onFile: (f: File) => void
  onClear: () => void
}

export default function UploadZone({ file, onFile, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) onFile(e.target.files[0])
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 border-2 border-brand-500 bg-brand-50 rounded-xl px-4 py-3">
        <div className="text-brand-500 text-2xl">✓</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{file.name}</div>
          <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB · Arama için hazır</div>
        </div>
        <button
          onClick={onClear}
          className="text-slate-400 hover:text-red-500 text-lg leading-none"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${
        dragging
          ? 'border-brand-500 bg-brand-50'
          : 'border-slate-200 hover:border-brand-400 hover:bg-slate-50'
      }`}
    >
      <div className="text-3xl mb-2 text-slate-300">↑</div>
      <div className="text-sm font-semibold text-slate-600">Dosyayı buraya bırakın</div>
      <div className="text-xs text-slate-400 mt-1">veya tıklayarak seçin · DWG, DXF, PDF</div>
      <input
        ref={inputRef}
        type="file"
        accept=".dwg,.dxf,.pdf"
        className="hidden"
        onChange={onChange}
      />
    </div>
  )
}
