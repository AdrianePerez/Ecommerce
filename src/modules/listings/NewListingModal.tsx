import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ErrorState, Field, Input, Modal, Select } from '@/components/ui'
import { friendlyDbError } from '@/lib/supabase'
import { ProductPicker } from '@/modules/invoices/ProductPicker'
import { createListing, listMarketplaces } from './api'

/** Cria um rascunho de anúncio já preenchido com o que o cadastro tem. */
export function NewListingModal({ open, onClose, product, marketplaceId }: {
  open: boolean; onClose: () => void; product?: { id: string; name: string } | null; marketplaceId?: string
}) {
  const navigate = useNavigate()
  const markets = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(product ?? null)
  const [market, setMarket] = useState(marketplaceId ?? '')
  const [variant, setVariant] = useState('')
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPicked(product ?? null); setVariant(''); setError(null)
    setMarket(marketplaceId ?? markets.data?.find((m) => m.active)?.id ?? '')
  }, [open, product, marketplaceId, markets.data])

  const create = useMutation({
    mutationFn: () => {
      const m = markets.data?.find((x) => x.id === market)
      if (!picked) throw new Error('Escolha o produto.')
      if (!m) throw new Error('Escolha o canal.')
      return createListing(picked.id, m, variant)
    },
    onSuccess: (l) => { onClose(); navigate(`/preparacao/${l.id}`) },
    onError: (e: Error) => setError(/product_listings_one_active/.test(e.message)
      ? 'Já existe um anúncio ativo deste produto neste canal. Use um rótulo de variação diferente (ex.: Premium) ou abra o existente.'
      : friendlyDbError(e)),
  })

  return (
    <>
      <Modal open={open && !picker} onClose={onClose} title="Novo anúncio"
        footer={<><Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Criar rascunho</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <ErrorState message={error} />}
          <Field label="Produto">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{picked?.name ?? <span className="text-muted">Nenhum escolhido</span>}</span>
              {!product && <Button size="sm" onClick={() => setPicker(true)}>{picked ? 'Trocar' : 'Escolher produto…'}</Button>}
            </div>
          </Field>
          <Field label="Canal" htmlFor="nl_market">
            <Select id="nl_market" value={market} onChange={(e) => setMarket(e.target.value)}>
              <option value="">Escolha…</option>
              {markets.data?.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Rótulo da variação (opcional)" htmlFor="nl_variant" hint="Só se for ter mais de um anúncio do mesmo produto no mesmo canal (ex.: Clássico e Premium).">
            <Input id="nl_variant" value={variant} onChange={(e) => setVariant(e.target.value)} maxLength={40} />
          </Field>
          <p className="text-xs text-muted">O rascunho já vem com título, descrição, atributos e imagens aprovadas montados a partir do cadastro. Tudo pode ser editado.</p>
        </div>
      </Modal>
      <ProductPicker open={picker} onClose={() => setPicker(false)} reasonRequired={false} confirmLabel="Escolher" title="Escolher produto" itemPrefix="" itemLabel=""
        onPick={(p) => { if (p) setPicked(p); setPicker(false) }} />
    </>
  )
}
