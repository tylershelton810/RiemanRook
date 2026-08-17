import { chooseTrump, createSession, discardKitty, fillMissingPlayersWithAi, playCard, recordBid, resetSessionForRematch, startNextHand } from '../game/session'
import { callPartner5, chooseTrump5, createSession5, discardKitty5, playCard5, recordBid5, resetSessionForRematch5, startNextHand5 } from '../game/session5'
import type { CardColor, RulesetId } from '../game/types'
import type { PlayerState, SessionState } from '../game/types'
import { supabase } from '../lib/supabase'
import type { LobbySeat } from '../lib/types'
import { getLobbySnapshot, syncAiSeatsFromPlayers } from './lobbies'

export function isFiveHanded(state: SessionState) {
  return state.rulesetId === 'rieman-rules-5' || state.players.length === 5
}

export function bidOn(state: SessionState, playerId: string, amount: number | null) {
  return isFiveHanded(state) ? recordBid5(state, playerId, amount) : recordBid(state, playerId, amount)
}

export function trumpOn(state: SessionState, playerId: string, color: CardColor) {
  return isFiveHanded(state) ? chooseTrump5(state, playerId, color) : chooseTrump(state, playerId, color)
}

export function discardOn(state: SessionState, playerId: string, cardIds: string[]) {
  return isFiveHanded(state) ? discardKitty5(state, playerId, cardIds) : discardKitty(state, playerId, cardIds)
}

export function playCardOn(state: SessionState, playerId: string, cardId: string) {
  return isFiveHanded(state) ? playCard5(state, playerId, cardId) : playCard(state, playerId, cardId)
}

export function nextHandOn(state: SessionState) {
  return isFiveHanded(state) ? startNextHand5(state) : startNextHand(state)
}

export function rematchOn(state: SessionState) {
  return isFiveHanded(state) ? resetSessionForRematch5(state) : resetSessionForRematch(state)
}

export function callOn(state: SessionState, playerId: string, cardId: string) {
  if (!isFiveHanded(state)) throw new Error('Naming a partner only applies to five-handed games.')
  return callPartner5(state, playerId, cardId)
}

export async function startGameSession(lobbyId: string, hostId: string, seats: LobbySeat[], turnTimer: number, winningScore: number, rulesetId: RulesetId = 'rieman-rules') {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (seats.some((seat) => seat.status === 'open')) throw new Error('Fill every seat before starting.')
  const expectedPlayers = rulesetId === 'rieman-rules-5' ? 5 : 4
  if (seats.length !== expectedPlayers) throw new Error(`A ${rulesetId === 'rieman-rules-5' ? 'five' : 'four'}-handed game requires ${expectedPlayers} seats.`)

  const players: PlayerState[] = seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    team: seat.team,
    hand: [],
    connected: true,
    isAi: seat.status === 'ai',
    difficulty: seat.difficulty,
  }))
  const sessionId = crypto.randomUUID()
  const gameState: SessionState = rulesetId === 'rieman-rules-5' ? createSession5(sessionId, players, 0, winningScore) : createSession(sessionId, players, 0, winningScore)
  const { data: session, error: sessionError } = await supabase.from('game_sessions').insert({
    lobby_id: lobbyId,
    ruleset_id: rulesetId,
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

export async function reconcileAiSeats(lobbyId: string, hostId: string): Promise<SessionState & { turnTimer: number } | null> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const session = await getCurrentGameSession(lobbyId)
  if (!session || session.status !== 'active') return null
  const seats = await getLobbySnapshot(lobbyId)
  const humanPlayerIds = new Set(seats.filter((seat) => seat.status === 'human').map((seat) => seat.id))
  const nextState = fillMissingPlayersWithAi(session.game_state, humanPlayerIds)
  if (nextState === session.game_state) return null
  const { error } = await supabase.from('game_sessions').update({ game_state: nextState }).eq('id', session.id).eq('status', 'active')
  if (error) throw error
  await syncAiSeatsFromPlayers(lobbyId, hostId, nextState.players)
  return nextState as SessionState & { turnTimer: number }
}

export async function submitBid(sessionId: string, state: SessionState, playerId: string, amount: number | null) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const nextState = bidOn(structuredClone(state), playerId, amount)
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
    // Tokens are awarded even when AI sat at the table. Idempotent via tokens_applied.
    try { await supabase.rpc('award_tokens_for_completed_game', { p_session_id: sessionId }) } catch { /* award can be retried later */ }
  }
  return data.game_state as SessionState & { turnTimer: number }
}

export async function submitTrump(sessionId: string, state: SessionState, playerId: string, color: CardColor) {
  return updateGameState(sessionId, trumpOn(structuredClone(state), playerId, color))
}

export async function submitDiscard(sessionId: string, state: SessionState, playerId: string, cardIds: string[]) {
  return updateGameState(sessionId, discardOn(structuredClone(state), playerId, cardIds))
}

export async function submitCard(sessionId: string, state: SessionState, playerId: string, cardId: string) {
  return updateGameState(sessionId, playCardOn(structuredClone(state), playerId, cardId))
}

export async function submitCall(sessionId: string, state: SessionState, playerId: string, cardId: string) {
  return updateGameState(sessionId, callOn(structuredClone(state), playerId, cardId))
}

export async function dealNextHand(sessionId: string, state: SessionState) {
  return updateGameState(sessionId, nextHandOn(structuredClone(state)))
}

export async function rematchSession(sessionId: string, lobbyId: string, state: SessionState) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const rematchState = rematchOn(state)
  const { data, error } = await supabase.from('game_sessions').update({ status: 'active', game_state: rematchState, completed_at: null, statistics_applied: false, tokens_applied: false }).eq('id', sessionId).select('game_state').single()
  if (error) throw error
  const { error: lobbyError } = await supabase.from('lobbies').update({ status: 'in_progress' }).eq('id', lobbyId)
  if (lobbyError) throw lobbyError
  return data.game_state as SessionState
}

export async function persistLocalGame(lobbyId: string, hostId: string, state: SessionState) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const completed = state.status === 'completed'
  const { data, error } = await supabase.from('game_sessions').upsert({
    id: state.id,
    lobby_id: lobbyId,
    ruleset_id: state.rulesetId ?? 'rieman-rules',
    status: completed ? 'completed' : 'active',
    game_state: state,
    completed_at: completed ? new Date().toISOString() : null,
  }, { onConflict: 'id' }).select('id').single()
  if (error) throw error
  const { error: lobbyError } = await supabase.from('lobbies').update({ status: completed ? 'finished' : 'in_progress' }).eq('id', lobbyId).eq('host_id', hostId)
  if (lobbyError) throw lobbyError
  if (completed) {
    // Result state is already persisted; the RPCs are idempotent and safe to retry.
    try { await supabase.rpc('finalize_session_statistics', { p_session_id: data.id }) } catch { /* best-effort */ }
    try { await supabase.rpc('award_tokens_for_completed_game', { p_session_id: data.id }) } catch { /* best-effort */ }
  }
  return data.id
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

export type LeaderboardNumbers = {
  gamesWon: number
  gamesCompleted: number
  handsPlayed: number
  handsBid: number
  winningBids: number
}

export type LeaderboardEntry = {
  userId: string
  name: string
  stats: LeaderboardNumbers
  five: LeaderboardNumbers
  ai: LeaderboardNumbers
  aiFive: LeaderboardNumbers
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase
    .from('player_statistics')
    .select('user_id, games_won, games_completed, hands_played, hands_bid, winning_bids, games5_won, games5_completed, hands5_played, hands5_bid, winning5_bids, ai_games_won, ai_games_completed, ai_hands_played, ai_hands_bid, ai_winning_bids, ai_games5_won, ai_games5_completed, ai_hands5_played, ai_hands5_bid, ai_winning5_bids, profile:profiles(display_name, stats_public)')
  if (error) throw error
  return (data ?? [])
    .map((row) => ({ row, profile: Array.isArray(row.profile) ? row.profile[0] : row.profile }))
    .filter(({ profile }) => profile?.stats_public !== false)
    .map(({ row, profile }) => ({
      userId: row.user_id,
      name: profile?.display_name?.trim() || 'Player',
      stats: {
        gamesWon: row.games_won ?? 0,
        gamesCompleted: row.games_completed ?? 0,
        handsPlayed: row.hands_played ?? 0,
        handsBid: row.hands_bid ?? 0,
        winningBids: row.winning_bids ?? 0,
      },
      five: {
        gamesWon: row.games5_won ?? 0,
        gamesCompleted: row.games5_completed ?? 0,
        handsPlayed: row.hands5_played ?? 0,
        handsBid: row.hands5_bid ?? 0,
        winningBids: row.winning5_bids ?? 0,
      },
      ai: {
        gamesWon: row.ai_games_won ?? 0,
        gamesCompleted: row.ai_games_completed ?? 0,
        handsPlayed: row.ai_hands_played ?? 0,
        handsBid: row.ai_hands_bid ?? 0,
        winningBids: row.ai_winning_bids ?? 0,
      },
      aiFive: {
        gamesWon: row.ai_games5_won ?? 0,
        gamesCompleted: row.ai_games5_completed ?? 0,
        handsPlayed: row.ai_hands5_played ?? 0,
        handsBid: row.ai_hands5_bid ?? 0,
        winningBids: row.ai_winning5_bids ?? 0,
      },
    }))
}

export async function getProfileNames(userIds: string[]): Promise<Record<string, string>> {
  if (!supabase) return {}
  const uuidIds = [...new Set(userIds)].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
  if (!uuidIds.length) return {}
  const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', uuidIds)
  if (error) throw error
  const names: Record<string, string> = {}
  ;(data ?? []).forEach((row) => {
    if (row.display_name?.trim()) names[row.id] = row.display_name.trim()
  })
  return names
}
