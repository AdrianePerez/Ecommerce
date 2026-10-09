// Tipos do banco escritos à mão a partir das migrações.
// Quando o projeto Supabase estiver ativo, substituir pelos tipos gerados
// (`supabase gen types typescript`), mantendo os apelidos exportados no fim do arquivo.

export type ProductStatus =
  | 'novo' | 'cadastro_fiscal_pendente' | 'pesquisando' | 'aguardando_revisao'
  | 'em_preparacao' | 'pronto' | 'publicado' | 'arquivado'
export type DataSource = 'manual' | 'nfe' | 'catalogo' | 'pesquisa' | 'ia'
export type ValidationStatus =
  | 'encontrada' | 'aguardando_revisao' | 'confirmada' | 'rejeitada' | 'divergente' | 'nao_encontrada'
export type IdentifierType = 'ean' | 'supplier_sku' | 'outro'
export type UserRole = 'admin' | 'operador'
type CapacityUnit = 'L' | 'mL' | 'kg' | 'g' | 'un'

/** numeric do Postgres: chega como number; pode ser enviado como string para não perder precisão. */
type Num = number
type NumIn = number | string

export interface Product {
  id: string
  internal_sku: string | null
  supplier_sku: string | null
  ean: string | null
  nf_description: string | null
  commercial_name: string | null
  brand: string | null
  model: string | null
  collection: string | null
  collection_year: number | null
  main_supplier_id: string | null
  ncm: string | null
  cest: string | null
  fiscal_origin: number | null
  fiscal_source: DataSource | null
  unit: string | null
  material: string | null
  color: string | null
  capacity_value: Num | null
  capacity_unit: CapacityUnit | null
  height_mm: Num | null
  width_mm: Num | null
  depth_mm: Num | null
  weight_g: Num | null
  pkg_height_mm: Num | null
  pkg_width_mm: Num | null
  pkg_depth_mm: Num | null
  gross_weight_g: Num | null
  notes: string | null
  status: ProductStatus
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type NumericKeys = 'capacity_value' | 'height_mm' | 'width_mm' | 'depth_mm' | 'weight_g'
  | 'pkg_height_mm' | 'pkg_width_mm' | 'pkg_depth_mm' | 'gross_weight_g'

export type ProductInsert = Partial<Omit<Product, 'id' | 'created_at' | 'updated_at' | 'created_by' | NumericKeys>> & {
  [K in NumericKeys]?: NumIn | null
}

export interface ProductOverview extends Product {
  supplier_name: string | null
  missing_dimensions: boolean
  missing_weight: boolean
  missing_fiscal: boolean
  missing_commercial_name: boolean
  missing_count: number
}

export interface Supplier {
  id: string
  name: string
  trade_name: string | null
  cnpj: string | null
  notes: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
export type SupplierInsert = Pick<Supplier, 'name'> & Partial<Pick<Supplier, 'trade_name' | 'cnpj' | 'notes' | 'archived_at'>>

export interface ProductIdentifier {
  id: string
  product_id: string
  id_type: IdentifierType
  value: string
  supplier_id: string | null
  source: DataSource
  match_reason: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
}

export interface ProductAttribute {
  id: string
  product_id: string
  attr_key: string
  label: string | null
  value_text: string | null
  value_num: Num | null
  unit: string | null
  source: DataSource
  source_ref: string | null
  confidence: Num | null
  validation_status: ValidationStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  active: boolean
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: number
  table_name: string
  record_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  actor_id: string | null
  created_at: string
}
