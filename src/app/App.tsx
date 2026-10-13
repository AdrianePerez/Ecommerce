import { GalleryPage } from '@/modules/images/GalleryPage'
import { PricingPage } from '@/modules/pricing/PricingPage'
import { ShowcasePage } from '@/modules/showcase/ShowcasePage'
import { ListingsPage } from '@/modules/listings/ListingsPage'
import { ListingEditPage } from '@/modules/listings/ListingEditPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button, ErrorState, Spinner } from '@/components/ui'
import { ToastProvider } from '@/components/ui/toast'
import { supabaseConfigError } from '@/lib/supabase'
import { AppLayout } from './AppLayout'
import { AuthProvider, useAuth } from './auth'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/modules/auth/AuthPages'
import { DashboardPage } from '@/modules/dashboard/DashboardPage'
import { ProductsListPage } from '@/modules/products/ProductsListPage'
import { ProductEditPage } from '@/modules/products/ProductEditPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { InvoicesListPage } from '@/modules/invoices/InvoicesListPage'
import { ImportPage } from '@/modules/invoices/ImportPage'
import { InvoiceDetailPage } from '@/modules/invoices/InvoiceDetailPage'
import { CatalogsListPage } from '@/modules/catalogs/CatalogsListPage'
import { UploadCatalogPage } from '@/modules/catalogs/UploadCatalogPage'
import { CatalogDetailPage } from '@/modules/catalogs/CatalogDetailPage'
import { PageReviewPage } from '@/modules/catalogs/PageReviewPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, profile, profileError, recovering, signOut } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  if (recovering) return <Navigate to="/redefinir-senha" replace />
  if (!profile && !profileError) return <Spinner />
  if (!profile || !profile.active)
    return (
      <div className="mx-auto mt-20 max-w-md px-4">
        <ErrorState
          message={
            profile && !profile.active
              ? 'Seu usuário está desativado. Fale com um administrador.'
              : `Não foi possível carregar seu perfil. ${profileError ?? ''}`
          }
        />
        <Button className="mt-4" onClick={signOut}>Sair</Button>
      </div>
    )
  return <>{children}</>
}

function ConfigMissing() {
  return (
    <div className="mx-auto mt-20 max-w-lg px-4">
      <ErrorState message={supabaseConfigError!} />
    </div>
  )
}

export default function App() {
  if (supabaseConfigError) return <ConfigMissing />
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
              <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
              <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<DashboardPage />} />
                <Route path="produtos" element={<ProductsListPage />} />
                <Route path="produtos/novo" element={<ProductEditPage />} />
                <Route path="produtos/:id" element={<ProductEditPage />} />
                <Route path="entradas" element={<InvoicesListPage />} />
                <Route path="entradas/importar" element={<ImportPage />} />
                <Route path="entradas/:id" element={<InvoiceDetailPage />} />
                <Route path="catalogos" element={<CatalogsListPage />} />
                <Route path="catalogos/novo" element={<UploadCatalogPage />} />
                <Route path="catalogos/:id" element={<CatalogDetailPage />} />
                <Route path="catalogos/:id/paginas/:n" element={<PageReviewPage />} />
                <Route path="preparacao" element={<ListingsPage />} />
                <Route path="preparacao/:id" element={<ListingEditPage />} />
                <Route path="imagens" element={<GalleryPage />} />
                <Route path="precificacao" element={<PricingPage />} />
                <Route path="vitrine" element={<ShowcasePage />} />
                <Route path="configuracoes" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
