import { chooseTrump, createSession, discardKitty, playCard, recordBid, startNextHand } from '../game/session'
import type { CardColor } from '../game/types'
import type { PlayerState, SessionState } from '../game/types'
import { supabase } from '../lib/supabase'
import type { LobbySeat } from '../lib/types'

export async function startGameSession(lobbyId: string, hostId: string, seats: LobbySeat[], turnTimer: number, winningScore: number) {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (seats.some((seat) => seat.status === 'open')) throw new Error('Fill every seat before starting.')

  const players: PlayerState[] = seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    team: seat.team,
    hand: [],
    connected: true,
    isAi: seat.status === 'ai',
  }))
  const sessionId = crypto.randomUUID()
  const gameState: SessionState = createSession(sessionId, players, 0, winningScore)
  const { data: session, error: sessionError } = await supabase.from('game_sessions').insert({
    lobby_id: lobbyId,
    ruleset_id: 'rieman-rules',
    status: 'active',
    game_state: { ...gameState, turnTimer, winningScore },
  }).select('id, game_state').single()
  if (sessionError) throw sessionError
  const { error: lobbyError } = await supabase.from('lobbies').update({ status: 'in_progress' }).eq('id', lobbyId).eq('host_id', hostId)
  if (lobbyError) throw lobbyError
  return session as { id: string; game_state: SessionState & { turnTimer: number } }
}

export async function getActiveGameSession(lobbyId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('game_sessions').select('id, game_state').eq('lobby_id', lobbyId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data as { id: string; game_state: SessionState & { turnTimer: number } } | null
}

export async function getCurrentGameSession(lobbyId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('game_sessions').select('id, game_state, status').eq('lobby_id', lobbyId).in('status', ['active', 'completed']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data as { id: string; status: 'active' | 'completed'; game_state: SessionState & { turnTimer: number } } | null
}

export async function submitBid(sessionId: string, state: SessionState, playerId: string, amount: number | null) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const nextState = recordBid(structuredClone(state), playerId, amount)
  const { data, error } = await supabase.from('game_sessions').update({ game_state: nextState }).eq('id', sessionId).eq('status', 'active').select('game_state').single()
  if (error) throw error
  return data.game_state as SessionState & { turnTimer: number }
}

async function updateGameState(sessionId: string, state: SessionState) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('game_sessions').update({ game_state: state, status: state.status === 'completed' ? 'completed' : 'active', completed_at: state.status === 'completed' ? new Date().toISOString() : null }).eq('id', sessionId).eq('status', 'active').select('game_state').single()
  if (error) throw error
  if (state.status === 'completed') {
    // The result screen must not depend on statistics finalization succeeding.
    // The RPC is idempotent and can be retried independently.
    try { await supabase.rpc('finalize_session_statistics', { p_session_id: sessionId }) } catch { /* result state is already persisted */ }
  }
  return data.game_state as SessionState & { turnTimer: number }
}

export async function submitTrump(sessionId: string, state: SessionState, playerId: string, color: CardColor) {
  return updateGameState(sessionId, chooseTrump(structuredClone(state), playerId, color))
}

export async function submitDiscard(sessionId: string, state: SessionState, playerId: string, cardIds: string[]) {
  return updateGameState(sessionId, discardKitty(structuredClone(state), playerId, cardIds))
}

export async function submitCard(sessionId: string, state: SessionState, playerId: string, cardId: string) {
  return updateGameState(sessionId, playCard(structuredClone(state), playerId, cardId))
}

export async function dealNextHand(sessionId: string, state: SessionState) {
  return updateGameState(sessionId, startNextHand(structuredClone(state)))
}

export async function rematchSession(sessionId: string, lobbyId: string, state: SessionState) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const rematchState = { ...state, status: 'active' as const, scores: { A: 0, B: 0 }, handNumber: 0, stats: Object.fromEntries(state.players.map((player) => [player.id, { handsPlayed: 0, handsBid: 0, winningBids: 0, colors: {}, partners: {} }])) }
  const { data, error } = await supabase.from('game_sessions').update({ status: 'active', game_state: rematchState, completed_at: null }).eq('id', sessionId).select('game_state').single()
  if (error) throw error
  const { error: lobbyError } = await supabase.from('lobbies').update({ status: 'in_progress' }).eq('id', lobbyId)
  if (lobbyError) throw lobbyError
  return data.game_state as SessionState
}

export async function closeLobby(lobbyId: string, hostId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.from('lobbies').update({ status: 'finished' }).eq('id', lobbyId).eq('host_id', hostId)
  if (error) throw error
}

export async function getPlayerStatistics(userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('player_statistics').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}
