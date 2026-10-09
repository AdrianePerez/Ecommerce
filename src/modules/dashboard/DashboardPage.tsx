import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorState, PageHeader, Spinner } from '@/components/ui'
import { supabase, friendlyDbError } from '@/lib/supabase'

type Indicator = { key: string; label: string; to: string; apply: (q: any) => any }

// Indicadores comerciais disponíveis na fase 1. Os financeiros e de anúncios
// entram junto com os respectivos módulos.
const INDICATORS: Indicator[] = [
  { key: 'total', label: 'Produtos cadastrados', to: '/produtos', apply: (q) => q },
  { key: 'incomplete', label: 'Cadastro incompleto', to: '/produtos?incomplete=1', apply: (q) => q.gt('missing_count', 0) },
  { key: 'dims', label: 'Sem dimensões', to: '/produtos?missingDimensions=1', apply: (q) => q.eq('missing_dimensions', true) },
  { key: 'weight', label: 'Sem peso', to: '/produtos?missingWeight=1', apply: (q) => q.eq('missing_weight', true) },
  { key: 'prep', label: 'Em preparação', to: '/produtos?status=em_preparacao', apply: (q) => q.eq('status', 'em_preparacao') },
  { key: 'ready', label: 'Prontos para publicar', to: '/produtos?status=pronto', apply: (q) => q.eq('status', 'pronto') },
]

async function loadCounts() {
  const results = await Promise.all(
    INDICATORS.map(async (i) => {
      const base = supabase.from('product_overview').select('id', { count: 'exact', head: true }).is('archived_at', null)
      const { count, error } = await i.apply(base)
      if (error) throw error
      return [i.key, count ?? 0] as const
    }),
  )
  return Object.fromEntries(results) as Record<string, number>
}

export function DashboardPage() {
  const counts = useQuery({ queryKey: ['dashboard', 'products'], queryFn: loadCounts })
  return (
    <>
      <PageHeader title="Dashboard" description="Indicadores calculados a partir do cadastro de produtos." />
      {counts.isPending ? <Spinner /> : counts.isError ? (
        <ErrorState message={friendlyDbError(counts.error)} onRetry={() => counts.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {INDICATORS.map((i) => (
            <Link key={i.key} to={i.to} className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent">
              <div className="text-xs text-muted">{i.label}</div>
              <div className="tabular mt-1 text-2xl font-semibold">{counts.data[i.key].toLocaleString('pt-BR')}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
