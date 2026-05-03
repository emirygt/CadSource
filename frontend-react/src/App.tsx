import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/auth'

function AuthLogoutListener() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  useEffect(() => {
    const handler = () => { logout(); navigate('/login', { replace: true }) }
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
  }, [logout, navigate])
  return null
}

import ProtectedRoute    from '@/components/layout/ProtectedRoute'
import AppLayout         from '@/components/layout/AppLayout'
import LoginPage         from '@/pages/Login'
import SearchPage        from '@/pages/Search'
import ProductsPage      from '@/pages/Products'
import MoldsPage         from '@/pages/Molds'
import RequestsPage      from '@/pages/Requests'
import CategoriesPage    from '@/pages/Categories'
import DecisionsPage     from '@/pages/Decisions'
import DashboardPage     from '@/pages/Dashboard'
import ComparePage       from '@/pages/Compare'
import FilterPage        from '@/pages/Filter'
import UploadPage        from '@/pages/Upload'
import LibraryPage       from '@/pages/Library'
import AttrDefsPage      from '@/pages/AttrDefs'
import DuplicatesPage    from '@/pages/Duplicates'
import ContourPage       from '@/pages/Contour'
import ScanPage          from '@/pages/Scan'
import CadProPage        from '@/pages/CadPro'
import ImageEditorPage   from '@/pages/ImageEditor'
import ReportsPage       from '@/pages/Reports'
import AnalyticsPage     from '@/pages/Analytics'
import ExecutiveReportPage from '@/pages/ExecutiveReport'
import AdminPage         from '@/pages/Admin'
import AdminRolesPage    from '@/pages/AdminRoles'
import LogsPage          from '@/pages/Logs'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter basename="/app">
        <AuthLogoutListener />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/search" replace />} />
              <Route path="search"           element={<SearchPage />} />
              <Route path="compare"          element={<ComparePage />} />
              <Route path="filter"           element={<FilterPage />} />
              <Route path="upload"           element={<UploadPage />} />
              <Route path="library"          element={<LibraryPage />} />
              <Route path="categories"       element={<CategoriesPage />} />
              <Route path="attr-defs"        element={<AttrDefsPage />} />
              <Route path="duplicates"       element={<DuplicatesPage />} />
              <Route path="contour"          element={<ContourPage />} />
              <Route path="scan"             element={<ScanPage />} />
              <Route path="cad-pro"          element={<CadProPage />} />
              <Route path="image-editor"     element={<ImageEditorPage />} />
              <Route path="reports"          element={<ReportsPage />} />
              <Route path="decisions"        element={<DecisionsPage />} />
              <Route path="analytics"        element={<AnalyticsPage />} />
              <Route path="executive-report" element={<ExecutiveReportPage />} />
              <Route path="products"         element={<ProductsPage />} />
              <Route path="molds"            element={<MoldsPage />} />
              <Route path="requests"         element={<RequestsPage />} />
              <Route path="admin"            element={<AdminPage />} />
              <Route path="admin-roles"      element={<AdminRolesPage />} />
              <Route path="logs"             element={<LogsPage />} />
              <Route path="dashboard"        element={<DashboardPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/search" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
