import type { Difficulty, LobbySeat, SeatTeam } from '../lib/types'
import { supabase } from '../lib/supabase'

export interface LobbyMemberRow {
  lobby_id: string
  user_id: string
  seat_index: number
  team: SeatTeam
  is_host: boolean
  connected_at: string
  profile?: { display_name: string; crow_logo?: string | null } | { display_name: string; crow_logo?: string | null }[] | null
}

export interface LobbyRecord {
  id: string
  join_code: string
  host_id: string
  name: string
  status: 'waiting' | 'in_progress' | 'finished'
  settings: { ruleset: string; turnTimer: number; winningScore?: number }
  members: LobbyMemberRow[]
}

export interface LobbySummary {
  id: string
  join_code: string
  host_id: string
  name: string
  status: 'waiting' | 'in_progress' | 'finished'
  settings: { ruleset?: string; turnTimer?: number; winningScore?: number }
}

const LOBBY_NAMES = [
  'Midnight Rooks', 'Rowdy Crows', 'Hollow Oak', 'Silver Beak',
  'Thistle Table', 'Moonlit Roost', 'Whistling Crows', 'Smoke & Feathers',
  'Blue Ridge Rooks', 'Gilded Perch', 'Scrappy Crows', 'Long Meadow',
  'Cinder Hill', 'Rook & Thorn', 'Dusty Wings', 'Copper Crest',
]

export function generateLobbyName() {
  return LOBBY_NAMES[Math.floor(Math.random() * LOBBY_NAMES.length)]
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function generateJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const suffix = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `CROW-${suffix}`
}

function seatCountForRuleset(ruleset: string) {
  return ruleset === 'rieman-rules-5' ? 5 : 4
}

function teamForIndex(index: number, seatCount: number): SeatTeam {
  if (seatCount === 5) return 'ABCDE'[index] as SeatTeam
  return index % 2 === 0 ? 'A' : 'B'
}

export async function ensureProfile(userId: string, email?: string, displayName?: string) {
  const client = requireClient()
  const { error } = await client.from('profiles').upsert({ id: userId, display_name: displayName?.trim() || email?.split('@')[0] || 'Player' }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

export async function getDisplayName(userId: string): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.from('profiles').select('display_name').eq('id', userId).maybeSingle()
  if (error) throw error
  return data?.display_name?.trim() ?? ''
}

export async function setDisplayName(userId: string, displayName: string): Promise<string> {
  const client = requireClient()
  const trimmed = displayName.trim().slice(0, 40)
  if (!trimmed) throw new Error('Give yourself a name first.')
  const { error } = await client.from('profiles').upsert({ id: userId, display_name: trimmed }, { onConflict: 'id' })
  if (error) throw error
  return trimmed
}

export async function createLobby(userId: string, name?: string, ruleset: string = 'rieman-rules') {
  const client = requireClient()
  const seatCount = seatCountForRuleset(ruleset)
  const initialSeats: LobbySeat[] = Array.from({ length: seatCount }, (_, index) => index === 0
    ? { id: userId, name: 'You', status: 'human', team: 'A' }
    : { id: `seat-${index}`, name: 'Open seat', status: 'open', team: teamForIndex(index, seatCount) })
  const { data: lobby, error } = await client.from('lobbies').insert({ join_code: generateJoinCode(), host_id: userId, name: name?.trim() || generateLobbyName(), seats: initialSeats, settings: { ruleset, turnTimer: 30, winningScore: 500 } }).select('id, join_code, host_id, name, status, settings').single()
  if (error) throw error
  const { error: memberError } = await client.from('lobby_players').insert({ lobby_id: lobby.id, user_id: userId, seat_index: 0, team: 'A', is_host: true })
  if (memberError) throw memberError
  return lobby as Omit<LobbyRecord, 'members'>
}

export async function updateLobbySettings(lobbyId: string, hostId: string, settings: { turnTimer: number; winningScore: number }) {
  const client = requireClient()
  const { data: lobby, error: readError } = await client.from('lobbies').select('settings').eq('id', lobbyId).eq('host_id', hostId).single()
  if (readError) throw readError
  const current = (lobby?.settings ?? {}) as { ruleset?: string; turnTimer?: number; winningScore?: number }
  const { data, error } = await client.from('lobbies').update({ settings: { ...current, ...settings } }).eq('id', lobbyId).eq('host_id', hostId).select('settings').single()
  if (error) throw error
  return data.settings as { turnTimer: number; winningScore: number }
}

export async function updateLobbyName(lobbyId: string, hostId: string, name: string) {
  const client = requireClient()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the table a name first.')
  const { data, error } = await client.from('lobbies').update({ name: trimmed }).eq('id', lobbyId).eq('host_id', hostId).select('name').single()
  if (error) throw error
  return data as { name: string }
}

export async function findLobbyByCode(code: string) {
  const client = requireClient()
  const { data, error } = await client.from('lobbies').select('id, join_code, host_id, name, status, settings').eq('join_code', code.trim().toUpperCase()).eq('status', 'waiting').single()
  if (error) throw new Error('No waiting lobby was found with that code.')
  return data as Omit<LobbyRecord, 'members'>
}

export async function getLobbyMembers(lobbyId: string) {
  const client = requireClient()
  const { data, error } = await client.from('lobby_players').select('lobby_id, user_id, seat_index, team, is_host, connected_at, profile:profiles(display_name, crow_logo)').eq('lobby_id', lobbyId).order('seat_index')
  if (error) throw error
  return (data ?? []) as LobbyMemberRow[]
}

export async function getLobbyMemberLogos(lobbyId: string) {
  const client = requireClient()
  const { data, error } = await client.from('lobby_players').select('user_id, profile:profiles(crow_logo)').eq('lobby_id', lobbyId)
  if (error) throw error
  const logos: Record<string, string | null> = {}
  ;(data ?? []).forEach((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    logos[row.user_id] = profile?.crow_logo ?? null
  })
  return logos
}

export async function getLobbyMemberPlacements(lobbyId: string) {
  const client = requireClient()
  const { data, error } = await client.from('lobby_players').select('user_id, profile:profiles(placement)').eq('lobby_id', lobbyId)
  if (error) throw error
  const placements: Record<string, string | null> = {}
  ;(data ?? []).forEach((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    placements[row.user_id] = profile?.placement ?? null
  })
  return placements
}

export async function getLobbyMemberFonts(lobbyId: string) {
  const client = requireClient()
  const { data, error } = await client.from('lobby_players').select('user_id, profile:profiles(card_font)').eq('lobby_id', lobbyId)
  if (error) throw error
  const fonts: Record<string, string | null> = {}
  ;(data ?? []).forEach((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    fonts[row.user_id] = profile?.card_font ?? null
  })
  return fonts
}

export async function joinLobby(lobbyId: string, userId: string) {
  const client = requireClient()
  const members = await getLobbyMembers(lobbyId)
  if (members.some((member) => member.user_id === userId)) return members
  const { data: lobby, error: lobbyError } = await client.from('lobbies').select('settings').eq('id', lobbyId).single()
  if (lobbyError) throw lobbyError
  const seatCount = seatCountForRuleset(lobby?.settings?.ruleset ?? 'rieman-rules')
  const usedSeats = new Set(members.map((member) => member.seat_index))
  const seatIndex = Array.from({ length: seatCount - 1 }, (_, index) => index + 1).find((index) => !usedSeats.has(index))
  if (seatIndex === undefined) throw new Error('This lobby is full.')
  const { error } = await client.from('lobby_players').insert({ lobby_id: lobbyId, user_id: userId, seat_index: seatIndex, team: teamForIndex(seatIndex, seatCount) })
  if (error) throw error
  return getLobbyMembers(lobbyId)
}

async function loadLobbySeats(lobbyId: string) {
  const client = requireClient()
  const [{ data: lobby, error: lobbyError }, members] = await Promise.all([
    client.from('lobbies').select('seats, settings').eq('id', lobbyId).single(),
    getLobbyMembers(lobbyId),
  ])
  if (lobbyError) throw lobbyError
  const seatCount = seatCountForRuleset(lobby?.settings?.ruleset ?? 'rieman-rules')
  const seats = membersToSeats(members, seatCount)
  const storedSeats = (lobby?.seats ?? []) as LobbySeat[]
  storedSeats.forEach((seat) => {
    if (seat.status === 'ai') seats[Number(seat.id.replace('seat-', ''))] = seat
  })
  return seats
}

export async function getLobbySnapshot(lobbyId: string) {
  return loadLobbySeats(lobbyId)
}

async function persistSeatModel(lobbyId: string, hostId: string, seats: LobbySeat[]) {
  const client = requireClient()
  const storedSeats = seats.map((seat, index) => seat.status === 'human'
    ? seat
    : { ...seat, id: `seat-${index}` })
  const { error: seatsError } = await client.from('lobbies').update({ seats: storedSeats }).eq('id', lobbyId).eq('host_id', hostId)
  if (seatsError) throw seatsError
  for (let index = 0; index < seats.length; index += 1) {
    const seat = seats[index]
    if (seat.status !== 'human') continue
    const { error } = await client.from('lobby_players').update({ seat_index: index, team: seat.team }).eq('lobby_id', lobbyId).eq('user_id', seat.id)
    if (error) throw error
  }
}

export async function swapSeats(lobbyId: string, hostId: string, firstId: string, secondId: string) {
  if (firstId === secondId) return loadLobbySeats(lobbyId)
  const seats = await loadLobbySeats(lobbyId)
  const firstIndex = seats.findIndex((seat) => seat.id === firstId)
  const secondIndex = seats.findIndex((seat) => seat.id === secondId)
  if (firstIndex === -1 || secondIndex === -1) throw new Error('That seat is no longer available.')
  const teamForSeatIndex = (index: number) => teamForIndex(index, seats.length)
  const swapped = seats.map((seat, index) => {
    if (index === firstIndex) return { ...seats[secondIndex], team: teamForSeatIndex(firstIndex) }
    if (index === secondIndex) return { ...seats[firstIndex], team: teamForSeatIndex(secondIndex) }
    return seat
  })
  await persistSeatModel(lobbyId, hostId, swapped)
  return loadLobbySeats(lobbyId)
}

export async function setSeatTeam(lobbyId: string, hostId: string, seatId: string, team: SeatTeam) {
  const seats = await loadLobbySeats(lobbyId)
  const index = seats.findIndex((seat) => seat.id === seatId)
  if (index === -1) throw new Error('That seat is no longer available.')
  const updated = seats.map((seat, seatIndex) => seatIndex === index ? { ...seat, team } : seat)
  await persistSeatModel(lobbyId, hostId, updated)
  return loadLobbySeats(lobbyId)
}

export async function getMyLobbies(userId: string) {
  const client = requireClient()
  const { data: membership, error: membershipError } = await client
    .from('lobby_players')
    .select('lobby_id')
    .eq('user_id', userId)
    .order('connected_at', { ascending: false })
  if (membershipError) throw membershipError
  const lobbyIds = (membership ?? []).map((row) => row.lobby_id)
  if (!lobbyIds.length) return []
  const { data: lobbies, error } = await client.from('lobbies')
    .select('id, join_code, host_id, name, status, settings, updated_at')
    .in('id', lobbyIds)
    .in('status', ['waiting', 'in_progress'])
  if (error) throw error
  return (lobbies ?? []).sort((left, right) => (Date.parse(right.updated_at ?? '') || 0) - (Date.parse(left.updated_at ?? '') || 0)) as LobbySummary[]
}

export async function leaveLobby(lobbyId: string, userId: string) {
  const client = requireClient()
  const { data: lobby } = await client.from('lobbies').select('host_id').eq('id', lobbyId).single()
  const { error: leaveError } = await client.from('lobby_players').delete().eq('lobby_id', lobbyId).eq('user_id', userId)
  if (leaveError) throw leaveError
  if (!lobby || lobby.host_id !== userId) return
  const members = await getLobbyMembers(lobbyId)
  const nextHost = members[0]
  if (!nextHost) return
  const { error: clearError } = await client.from('lobby_players').update({ is_host: false }).eq('lobby_id', lobbyId)
  if (clearError) throw clearError
  const { error: promoteError } = await client.from('lobby_players').update({ is_host: true }).eq('lobby_id', lobbyId).eq('user_id', nextHost.user_id)
  if (promoteError) throw promoteError
  const { error: hostError } = await client.from('lobbies').update({ host_id: nextHost.user_id }).eq('id', lobbyId)
  if (hostError) throw hostError
}

export async function syncAiSeatsFromPlayers(lobbyId: string, hostId: string, players: Array<{ id: string; name: string; team: string; isAi: boolean }>) {
  const client = requireClient()
  const members = await getLobbyMembers(lobbyId)
  const seats = membersToSeats(members, players.length)
  players.forEach((player, seatIndex) => {
    if (player.isAi && seatIndex < seats.length) {
      seats[seatIndex] = { id: player.id, name: player.name, status: 'ai', team: player.team as SeatTeam, difficulty: 'Average' }
    }
  })
  const { error } = await client.from('lobbies').update({ seats }).eq('id', lobbyId).eq('host_id', hostId)
  if (error) throw error
}

export async function addAiSeat(lobbyId: string, hostId: string, seatId: string) {
  const client = requireClient()
  const { data: lobby, error: readError } = await client.from('lobbies').select('seats').eq('id', lobbyId).eq('host_id', hostId).single()
  if (readError) throw readError
  const seats = [...((lobby.seats ?? []) as LobbySeat[])]
  const seatIndex = seats.findIndex((seat) => seat.id === seatId)
  if (seatIndex === -1) throw new Error('That seat is no longer available.')
  const aiNames = ['Pip', 'Moss', 'Scout', 'Clover', 'Fern']
  const usedNames = new Set(seats.filter((seat) => seat.status === 'ai').map((seat) => seat.name))
  const aiName = aiNames.find((name) => !usedNames.has(name)) ?? `Crow AI ${usedNames.size + 1}`
  seats[seatIndex] = { ...seats[seatIndex], name: aiName, status: 'ai', difficulty: 'Average' }
  const { error } = await client.from('lobbies').update({ seats }).eq('id', lobbyId).eq('host_id', hostId)
  if (error) throw error
  return seats
}

export async function setAiSeatDifficulty(lobbyId: string, hostId: string, seatId: string, difficulty: Difficulty) {
  const client = requireClient()
  const { data: lobby, error: readError } = await client.from('lobbies').select('seats').eq('id', lobbyId).eq('host_id', hostId).single()
  if (readError) throw readError
  const seats = [...((lobby.seats ?? []) as LobbySeat[])]
  const seatIndex = seats.findIndex((seat) => seat.id === seatId)
  if (seatIndex === -1) throw new Error('That seat is no longer available.')
  seats[seatIndex] = { ...seats[seatIndex], difficulty }
  const { error } = await client.from('lobbies').update({ seats }).eq('id', lobbyId).eq('host_id', hostId)
  if (error) throw error
  return seats
}

export function membersToSeats(members: LobbyMemberRow[], seatCount = 4): LobbySeat[] {
  const seats: LobbySeat[] = Array.from({ length: seatCount }, (_, seatIndex) => ({ id: `seat-${seatIndex}`, name: 'Open seat', status: 'open', team: teamForIndex(seatIndex, seatCount) }))
  members.forEach((member) => {
    const profile = Array.isArray(member.profile) ? member.profile[0] : member.profile
    seats[member.seat_index] = { id: member.user_id, name: profile?.display_name ?? 'Player', status: 'human', team: member.team }
  })
  return seats
}
