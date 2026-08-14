import { supabase } from '../lib/supabase'

export interface CrowLogoRecord {
  id: string
  name: string
  storage_path: string
  created_at?: string
}

const BUCKET = 'crow-logos'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function getMyCrowLogo(userId: string): Promise<string | null> {
  const client = requireClient()
  const { data, error } = await client.from('profiles').select('crow_logo').eq('id', userId).maybeSingle()
  if (error) throw error
  return data?.crow_logo ?? null
}

export async function setCrowLogo(userId: string, logoId: string | null) {
  const client = requireClient()
  const { error } = await client.from('profiles').update({ crow_logo: logoId }).eq('id', userId)
  if (error) throw error
}

export async function listCrowLogos(): Promise<CrowLogoRecord[]> {
  const client = requireClient()
  const { data, error } = await client.from('crow_logos').select('id, name, storage_path').order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CrowLogoRecord[]
}

export function crowLogoUrl(record: { storage_path: string }) {
  const client = requireClient()
  return client.storage.from(BUCKET).getPublicUrl(record.storage_path).data.publicUrl
}

export async function uploadCrowLogo(userId: string, file: File): Promise<CrowLogoRecord> {
  const client = requireClient()
  if (file.size > 2 * 1024 * 1024) throw new Error('Keep the image under 2 MB.')
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
  if (uploadError) throw uploadError
  const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 40) || 'Crow logo'
  const { data, error } = await client.from('crow_logos').insert({ name, storage_path: path, added_by: userId }).select('id, name, storage_path').single()
  if (error) throw error
  return data as CrowLogoRecord
}
