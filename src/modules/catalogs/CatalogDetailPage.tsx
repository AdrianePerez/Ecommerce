import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { CATALOG_STATUS_LABEL, deleteCatalog, getCatalog, listItems, listPages, signedUrls } from './api'
import { STATUS_TONE } from './CatalogsListPage'
import { thumbPath } from './pageModel'

const SIDE_LABEL = { F: '', L: 'esq.', R: 'dir.' } as const

export function CatalogDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [codeSearch, setCodeSearch] = useState('')

  const catalog = useQuery({ queryKey: ['catalog', id], queryFn: () => getCatalog(id!) })
  const pages = useQuery({ queryKey: ['catalog-pages', id], queryFn: () => listPages(id!) })
  const items = useQuery({ queryKey: ['catalog-items', id], queryFn: () => listItems(id!) })
  const thumbs = useQuery({
    queryKey: ['catalog-thumbs', id, pages.data?.length],
    queryFn: () => signedUrls((pages.data ?? []).map((p) => thumbPath(p.image_path))),
    enabled: !!pages.data?.length,
    staleTime: 50 * 60 * 1000,
  })

  const remove = useMutation({
    mutationFn: () => deleteCatalog(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogs'] })
      toast('Catálogo excluído. Os dados já aprovados continuam nos produtos.')
      navigate('/catalogos', { replace: true })
    },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  const countByPage = useMemo(() => {
    const m = new Map<string, { total: number; pending: number; approved: number }>()
    for (const it of items.data ?? []) {
      const c = m.get(it.page_id) ?? { total: 0, pending: 0, approved: 0 }
      c.total++
      if (it.status === 'aguardando_revisao') c.pending++
      if (it.status === 'aprovado') c.approved++
      m.set(it.page_id, c)
    }
    return m
  }, [items.data])

  const codeHits = useMemo(() => {
    const t = codeSearch.trim().toUpperCase()
    if (t.length < 3) return null
    const pageIds = new Set((items.data ?? []).filter((i) => (i.code ?? '').toUpperCase().includes(t) || (i.name ?? '').toUpperCase().includes(t)).map((i) => i.page_id))
    for (const p of pages.data ?? []) if ((p.text_content ?? '').toUpperCase().includes(t)) pageIds.add(p.id)
    return pageIds
  }, [codeSearch, items.data, pages.data])

  if (catalog.isPending) return <Spinner />
  if (catalog.isError) return <ErrorState message={friendlyDbError(catalog.error)} onRetry={() => catalog.refetch()} />
  if (!catalog.data) return <ErrorState message="Catálogo não encontrado." />
  const c = catalog.data
  const visiblePages = (pages.data ?? []).filter((p) => !codeHits || codeHits.has(p.id))

  return (
    <>
      <Link to="/catalogos" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="size-4" aria-hidden /> Catálogos e coleções
      </Link>
      <PageHeader
        title={c.name}
        description={<span className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[c.status]}>{CATALOG_STATUS_LABEL[c.status]}</Badge>
          <span>{[c.supplier_name, c.brand, c.collection_year].filter(Boolean).join(' · ')}</span>
        </span>}
        actions={<Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" aria-hidden /> Excluir catálogo</Button>}
      />

      {c.status === 'enviando' && (
        <div className="mb-4 rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
          O envio deste catálogo não terminou. Em <Link to="/catalogos/novo" className="underline">Enviar catálogo</Link>, selecione o mesmo PDF para continuar.
        </div>
      )}
      {c.status === 'aguardando_processamento' && (
        <div className="mb-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted">
          A leitura automática com IA será ligada quando a chave da API estiver configurada. Enquanto isso, você já pode abrir as páginas, marcar os produtos e aprovar manualmente.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Páginas" value={c.page_count} />
        <Stat label="Produtos marcados" value={c.items_total} />
        <Stat label="A revisar" value={c.items_pending} />
        <Stat label="Aprovados" value={c.items_approved} />
      </div>

      <Card title="Páginas" actions={
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" aria-hidden />
          <Input className="h-8 pl-8" placeholder="Buscar código nas páginas" value={codeSearch} onChange={(e) => setCodeSearch(e.target.value)} aria-label="Buscar código nas páginas" />
        </div>
      }>
        {pages.isPending ? <Spinner /> : pages.isError ? <ErrorState message={friendlyDbError(pages.error)} /> :
          visiblePages.length === 0 ? <EmptyState title={codeHits ? 'Nenhuma página com esse código marcado' : 'Nenhuma página enviada'}
            description={codeHits ? 'A busca considera produtos já marcados e o texto das páginas.' : undefined} /> : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
            {visiblePages.map((p) => {
              const n = countByPage.get(p.id)
              const url = thumbs.data?.get(thumbPath(p.image_path))
              return (
                <Link key={p.id} to={`/catalogos/${c.id}/paginas/${p.page_number}`}
                  className="group flex flex-col gap-1 rounded-md border border-line p-1.5 hover:border-accent">
                  <div className="flex aspect-[7/10] items-center justify-center overflow-hidden rounded bg-sunk">
                    {url ? <img src={url} alt={`Página ${p.page_number}`} loading="lazy" className="h-full w-full object-contain" /> : <span className="text-xs text-muted">…</span>}
                  </div>
                  <div className="flex items-center justify-between gap-1 text-xs">
                    <span className="tabular">{p.page_number}<span className="text-muted"> · PDF {p.pdf_page} {SIDE_LABEL[p.side]}</span></span>
                    {n && (n.pending > 0 ? <Badge tone="warn">{n.pending}</Badge> : <Badge tone="good">{n.approved}</Badge>)}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs text-muted">Arquivo: {c.file_name} · enviado em {formatDate(c.created_at)} · impressão digital {c.file_sha256.slice(0, 12)}…</p>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir catálogo"
        footer={<>
          <Button onClick={() => setConfirmDelete(false)}>Cancelar</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Excluir definitivamente</Button>
        </>}>
        <div className="flex flex-col gap-2 text-sm">
          <p>As imagens das {c.page_count} páginas e os {c.items_total} produtos marcados neste catálogo serão excluídos.</p>
          <p>Medidas, materiais e atributos já <strong>aprovados</strong> continuam nos produtos, com a indicação de que vieram deste catálogo.</p>
          <p className="text-warn">Esta ação não pode ser desfeita.</p>
        </div>
      </Modal>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{value.toLocaleString('pt-BR')}</div>
    </div>
  )
}
