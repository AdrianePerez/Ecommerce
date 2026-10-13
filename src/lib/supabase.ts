import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Falta de configuração é mostrada na tela; o app não finge estar conectado. */
export const supabaseConfigError: string | null =
  !url || !anonKey
    ? 'As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não estão configuradas. Veja o arquivo .env.example.'
    : null

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Erros do banco em português para a interface. */
export function friendlyDbError(err: PostgrestError | Error | null | undefined): string {
  if (!err) return 'Erro desconhecido.'
  const e = err as PostgrestError
  const msg = e.message ?? String(err)
  if (msg.startsWith('NOTA_JA_IMPORTADA')) return 'Esta nota já foi importada.'
  if (msg.startsWith('ANUNCIO_INCOMPLETO:')) return `Para marcar como pronto, resolva: ${msg.slice('ANUNCIO_INCOMPLETO:'.length)}.`
  if (e.code === '23505') {
    if (msg.includes('products_internal_sku_key')) return 'Já existe um produto com este SKU interno.'
    if (msg.includes('suppliers_cnpj_key')) return 'Já existe um fornecedor com este CNPJ.'
    if (msg.includes('product_identifiers_ean_key')) return 'Este EAN já está vinculado a outro produto.'
    if (msg.includes('product_identifiers_supplier_sku_key')) return 'Este código já está vinculado a outro produto deste fornecedor.'
    if (msg.includes('product_images_sha_key')) return 'Esta imagem já está na galeria do produto.'
    if (msg.includes('product_images_catalog_item_id_key')) return 'Este recorte do catálogo já está na galeria.'
    if (msg.includes('product_listings_one_active')) return 'Já existe um anúncio ativo deste produto neste canal (use outro rótulo de variação).'
    if (msg.includes('product_attributes_confirmed_key')) return 'Já existe um valor confirmado para este atributo. Altere o estado do anterior primeiro.'
    return msg // mensagens próprias das funções do banco já estão em português
  }
  if (e.code === '42501') return msg.startsWith('new row violates') || msg.startsWith('permission denied')
    ? 'Você não tem permissão para esta operação.' : msg
  if (e.code === '23514') {
    if (msg.includes('product_images_main_approved')) return 'A imagem principal precisa estar aprovada e com uso permitido. Escolha outra principal antes.'
    if (!msg.includes('violates check constraint')) return msg // mensagens próprias dos gatilhos, já em português
    return `Valor fora das regras do cadastro (${msg.match(/"([^"]+)"/)?.[1] ?? 'verificação'}).`
  }
  if (e.code === '23503' && msg.includes('listing_assets')) return 'Esta imagem está em uso num anúncio. Tire do anúncio antes.'
  if (e.code === '23503') return 'Este registro está relacionado a outros dados e não pode ser alterado assim.'
  if (msg === 'Failed to fetch') return 'Sem conexão com o servidor. Verifique a internet e tente novamente.'
  return msg
}
