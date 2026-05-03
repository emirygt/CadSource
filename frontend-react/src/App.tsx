import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import ProtectedRoute from '@/components/layout/ProtectedRoute'
import AppLayout      from '@/components/layout/AppLayout'
import LoginPage      from '@/pages/Login'
import SearchPage     from '@/pages/Search'
import ProductsPage   from '@/pages/Products'
import MoldsPage      from '@/pages/Molds'
import RequestsPage   from '@/pages/Requests'
import CategoriesPage from '@/pages/Categories'
import DecisionsPage  from '@/pages/Decisions'
import DashboardPage  from '@/pages/Dashboard'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/search" replace />} />
              <Route path="search"     element={<SearchPage />} />
              <Route path="products"   element={<ProductsPage />} />
              <Route path="molds"      element={<MoldsPage />} />
              <Route path="requests"   element={<RequestsPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="decisions"  element={<DecisionsPage />} />
              <Route path="dashboard"  element={<DashboardPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/search" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
