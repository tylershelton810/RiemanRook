import { supabase } from '../lib/supabase'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function setCardAnimation(animationId: string | null) {
  const client = requireClient()
  const { error } = await client.rpc('select_card_animation', { p_animation_id: animationId })
  if (error) throw error
}

export async function purchaseCardAnimation(animationId: string): Promise<number> {
  const client = requireClient()
  const { data, error } = await client.rpc('purchase_card_animation', { p_animation_id: animationId })
  if (error) throw error
  return data as number
}
