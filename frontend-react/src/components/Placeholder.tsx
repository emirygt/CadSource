export default function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
      <div className="text-3xl">◌</div>
      <div className="text-sm">{label} — yapım aşamasında</div>
    </div>
  )
}
