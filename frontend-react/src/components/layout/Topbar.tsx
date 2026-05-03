import { useAuthStore } from '@/store/auth'

interface Props {
  title: string
}

export default function Topbar({ title }: Props) {
  const user = useAuthStore((s) => s.user)

  return (
    <header className="flex items-center justify-between h-12 px-5 bg-white border-b border-slate-200 shrink-0">
      <h1 className="text-sm font-semibold text-slate-800">{title}</h1>
      {user && (
        <span className="text-xs text-slate-500">{user.email}</span>
      )}
    </header>
  )
}
