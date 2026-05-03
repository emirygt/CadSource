import { NavLink } from 'react-router-dom'
import { useUIStore } from '@/store/ui'
import { useAuthStore } from '@/store/auth'

const NAV = [
  { to: '/search',     icon: '⌕',  label: 'Arama' },
  { to: '/products',   icon: '⬡',  label: 'Ürünler' },
  { to: '/molds',      icon: '◈',  label: 'Kalıplar' },
  { to: '/requests',   icon: '◎',  label: 'Talepler' },
  { to: '/categories', icon: '⊞',  label: 'Kategoriler' },
  { to: '/decisions',  icon: '✓',  label: 'Kararlar' },
  { to: '/dashboard',  icon: '▦',  label: 'Dashboard' },
]

export default function Sidebar() {
  const collapsed  = useUIStore((s) => s.sidebarCollapsed)
  const toggle     = useUIStore((s) => s.toggleSidebar)
  const logout     = useAuthStore((s) => s.logout)

  return (
    <aside
      className={`flex flex-col bg-sidebar text-slate-300 transition-all duration-200 shrink-0 ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-slate-700">
        <span className="text-brand-500 font-black text-lg leading-none">P</span>
        {!collapsed && (
          <span className="font-bold text-white text-sm tracking-tight">
            Profile<span className="text-brand-500">Axis</span>
          </span>
        )}
        <button
          onClick={toggle}
          className="ml-auto text-slate-500 hover:text-slate-300 text-xs"
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 mx-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:bg-slate-700 hover:text-white'
              }`
            }
          >
            <span className="text-base w-5 text-center shrink-0">{icon}</span>
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <button
        onClick={logout}
        className="flex items-center gap-3 px-3 py-3 mx-2 mb-2 rounded-md text-sm text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors"
      >
        <span className="text-base w-5 text-center">⎋</span>
        {!collapsed && <span>Çıkış</span>}
      </button>
    </aside>
  )
}
