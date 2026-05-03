import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

const PAGE_TITLES: Record<string, string> = {
  '/search':           'Arama',
  '/compare':          'Karşılaştırma',
  '/filter':           'Filtreleme',
  '/upload':           'Yükleme & Arşivleme',
  '/library':          'Profil / Kalıp Havuzu',
  '/categories':       'Kategoriler & Etiketler',
  '/attr-defs':        'Attribute Tanımları',
  '/duplicates':       'Mükerrer Kayıtlar',
  '/contour':          'Fotoğraftan Kontura',
  '/scan':             'Numuneden Çizime Hazırlık',
  '/cad-pro':          'CAD Pro Editörü',
  '/image-editor':     'Görsel Editörü',
  '/reports':          'Raporlar',
  '/decisions':        'Karar Kayıtları',
  '/analytics':        'Tasarruf / ROI',
  '/executive-report': 'Yönetici Raporu',
  '/products':         'Ürünler',
  '/molds':            'Kalıplar',
  '/requests':         'Talepler',
  '/admin':            'Kullanıcılar',
  '/admin-roles':      'Roller & İzinler',
  '/logs':             'Loglar',
  '/dashboard':        'Dashboard',
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? 'Profile Axis'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
