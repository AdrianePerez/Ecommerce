import { clsx } from 'clsx'
import {
  BarChart3, BookOpen, Boxes, CalendarDays, Calculator, Images, LayoutDashboard, LogOut, Menu,
  PackageOpen, Settings, Store, Wand2, X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from './auth'

type NavItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /** fase em que o módulo será entregue; enquanto isso fica desabilitado no menu */
  phase?: number
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/produtos', label: 'Produtos', icon: Boxes },
  { to: '/entradas', label: 'Entrada de mercadorias', icon: PackageOpen },
  { to: '/catalogos', label: 'Catálogos e coleções', icon: BookOpen },
  { to: '/preparacao', label: 'Central de preparação', icon: Wand2, phase: 4 },
  { to: '/imagens', label: 'Galeria de imagens', icon: Images, phase: 4 },
  { to: '/precificacao', label: 'Precificação', icon: Calculator, phase: 5 },
  { to: '/vitrine', label: 'Vitrine de anúncios', icon: Store, phase: 5 },
  { to: '/financeiro', label: 'Financeiro', icon: CalendarDays, phase: 6 },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
]

export function AppLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Menu principal">
      {NAV.map(({ to, label, icon: Icon, phase }) =>
        phase ? (
          <span
            key={to}
            className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-white/35"
            title={`Disponível na fase ${phase}`}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{label}</span>
            <span className="rounded bg-white/8 px-1.5 text-[10px] font-medium uppercase tracking-wide">Fase {phase}</span>
          </span>
        ) : (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                isActive ? 'bg-white/12 font-medium text-white' : 'text-white/75 hover:bg-white/6 hover:text-white',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </NavLink>
        ),
      )}
    </nav>
  )

  const sidebar = (
    <div className="flex h-full w-64 flex-col bg-[#13201b] text-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <BarChart3 className="size-5 text-[#5fc7a5]" aria-hidden />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Dualshop</div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50">Intelligence</div>
        </div>
      </div>
      {nav}
      <div className="border-t border-white/10 p-3">
        <div className="truncate text-sm">{profile?.full_name ?? profile?.email}</div>
        <div className="mb-2 text-xs text-white/50">{profile?.role === 'admin' ? 'Administrador' : 'Operador'}</div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/75 hover:bg-white/6 hover:text-white"
        >
          <LogOut className="size-4" aria-hidden /> Sair
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden shrink-0 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="relative h-full">{sidebar}</div>
          <button
            className="absolute top-3 left-[17rem] rounded-md bg-surface p-1.5"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1 hover:bg-sunk" aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">Dualshop Intelligence</span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
