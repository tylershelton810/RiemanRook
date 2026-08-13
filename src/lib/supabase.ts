import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.SUPABASE_URL
const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(url && publishableKey)
export const supabase = url && publishableKey ? createClient(url, publishableKey) : null
