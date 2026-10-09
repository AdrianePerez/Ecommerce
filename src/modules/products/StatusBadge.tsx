import { Badge } from '@/components/ui'
import { PRODUCT_STATUS_LABEL } from '@/lib/domain/product'
import type { ProductStatus } from '@/lib/database.types'

const TONE: Record<ProductStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  novo: 'neutral',
  cadastro_fiscal_pendente: 'warn',
  pesquisando: 'accent',
  aguardando_revisao: 'warn',
  em_preparacao: 'accent',
  pronto: 'good',
  publicado: 'good',
  arquivado: 'neutral',
}

export function StatusBadge({ status }: { status: ProductStatus }) {
  return <Badge tone={TONE[status]}>{PRODUCT_STATUS_LABEL[status]}</Badge>
}
