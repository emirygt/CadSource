import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useUIStore } from '@/store/ui'
import { useAuthStore } from '@/store/auth'

interface NavItem { to: string; label: string }
interface NavGroup { id: string; label: string; icon: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    id: 'ara', label: 'Ara & Karşılaştır', icon: '⌕',
    items: [
      { to: '/search',  label: 'Arama' },
      { to: '/compare', label: 'Karşılaştırma' },
      { to: '/filter',  label: 'Filtreleme' },
    ],
  },
  {
    id: 'kutuphane', label: 'Kütüphane', icon: '▤',
    items: [
      { to: '/upload',     label: 'Yükleme & Arşivleme' },
      { to: '/library',    label: 'Profil / Kalıp Havuzu' },
      { to: '/categories', label: 'Kategoriler & Etiketler' },
      { to: '/attr-defs',  label: 'Attribute Tanımları' },
      { to: '/duplicates', label: 'Mükerrer Kayıtlar' },
    ],
  },
  {
    id: 'digital', label: 'Dijitalleştirme', icon: '⬚',
    items: [
      { to: '/contour',       label: 'Fotoğraftan Kontura' },
      { to: '/scan',          label: 'Numuneden Çizime Hazırlık' },
      { to: '/cad-pro',       label: 'CAD Pro Editörü' },
      { to: '/image-editor',  label: 'Görsel Editörü' },
    ],
  },
  {
    id: 'raporlar', label: 'Kararlar & Raporlar', icon: '↗',
    items: [
      { to: '/reports',          label: 'Raporlar' },
      { to: '/decisions',        label: 'Karar Kayıtları' },
      { to: '/analytics',        label: 'Tasarruf / ROI' },
      { to: '/executive-report', label: 'Yönetici Raporu' },
    ],
  },
  {
    id: 'urun', label: 'Ürün Yönetimi', icon: '⬡',
    items: [
      { to: '/products', label: 'Ürünler' },
      { to: '/molds',    label: 'Kalıplar' },
      { to: '/requests', label: 'Talepler' },
    ],
  },
  {
    id: 'yonetim', label: 'Yönetim', icon: '⚙',
    items: [
      { to: '/admin',       label: 'Kullanıcılar' },
      { to: '/admin-roles', label: 'Roller & İzinler' },
      { to: '/logs',        label: 'Loglar' },
    ],
  },
]

export default function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggle    = useUIStore((s) => s.toggleSidebar)
  const logout    = useAuthStore((s) => s.logout)

  const [open, setOpen] = useState<Record<string, boolean>>({ ara: true })

  function toggleGroup(id: string) {
    setOpen((s) => ({ ...s, [id]: !s[id] }))
  }

  return (
    <aside
      className={`flex flex-col bg-sidebar text-slate-300 transition-all duration-200 shrink-0 ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-slate-700 shrink-0">
        <span className="text-brand-500 font-black text-lg leading-none">P</span>
        {!collapsed && (
          <span className="font-bold text-white text-sm tracking-tight">
            Profile<span className="text-brand-500">Axis</span>
          </span>
        )}
        <button onClick={toggle} className="ml-auto text-slate-500 hover:text-slate-300 text-xs">
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {GROUPS.map((group) => (
          <div key={group.id}>
            {/* Group header */}
            <button
              onClick={() => !collapsed && toggleGroup(group.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              <span className="text-sm shrink-0">{group.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left truncate">{group.label}</span>
                  <span className="text-slate-600 text-xs">{open[group.id] ? '▾' : '›'}</span>
                </>
              )}
            </button>

            {/* Sub-items */}
            {(collapsed || open[group.id]) && (
              <div className={collapsed ? '' : 'ml-2'}>
                {group.items.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md text-xs transition-colors ${
                        isActive
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                      }`
                    }
                  >
                    {collapsed ? (
                      <span className="w-full text-center text-xs leading-none">·</span>
                    ) : (
                      <span className="truncate">{label}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Logout */}
      <button
        onClick={logout}
        className="flex items-center gap-2 px-3 py-3 mx-2 mb-2 rounded-md text-xs text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors shrink-0"
      >
        <span className="w-5 text-center text-sm">⎋</span>
        {!collapsed && <span>Çıkış</span>}
      </button>
    </aside>
  )
}
