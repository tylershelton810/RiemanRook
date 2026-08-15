import { supabase } from '../lib/supabase'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function setCardFont(fontId: string | null) {
  const client = requireClient()
  const { error } = await client.rpc('select_card_font', { p_font_id: fontId })
  if (error) throw error
}

export async function purchaseCardFont(fontId: string): Promise<number> {
  const client = requireClient()
  const { data, error } = await client.rpc('purchase_card_font', { p_font_id: fontId })
  if (error) throw error
  return data as number
}
