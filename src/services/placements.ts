import { supabase } from '../lib/supabase'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function setPlacement(placementId: string | null) {
  const client = requireClient()
  const { error } = await client.rpc('select_placement', { p_placement_id: placementId })
  if (error) throw error
}

export async function purchasePlacement(placementId: string): Promise<number> {
  const client = requireClient()
  const { data, error } = await client.rpc('purchase_placement', { p_placement_id: placementId })
  if (error) throw error
  return data as number
}
