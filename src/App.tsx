import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { Difficulty, LobbySeat } from './lib/types'
import { addAiSeat, createLobby, ensureProfile, findLobbyByCode, getLobbySnapshot, joinLobby, getLobbyMembers, membersToSeats, updateLobbySettings } from './services/lobbies'
import { closeLobby, dealNextHand, getActiveGameSession, getPlayerStatistics, rematchSession, startGameSession, submitBid, submitTrump, submitDiscard, submitCard } from './services/sessions'
import { createConfetti } from './game/celebration'
import type { Card, SessionState } from './game/types'
import type { CardColor } from './game/types'
import { buildHandKnowledge, chooseAiBid, chooseAiCardWithKnowledge, chooseAiDiscard, chooseAiTrump } from './game/ai'
import { canPlayCard, leadColorForTrick } from './game/rules'
import { capturedPointsForTeam } from './game/session'

const avatarColors = ['coral', 'gold', 'sage', 'lavender']

function Avatar({ label, color = 'coral' }: { label: string; color?: string }) {
  return <span className={`avatar ${color}`}>{label.slice(0, 1).toUpperCase()}</span>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [playerStats, setPlayerStats] = useState<{ games_won: number; games_completed: number; hands_played: number } | null>(null)
  const [view, setView] = useState<'home' | 'lobby' | 'game'>('home')
  const [activeGame, setActiveGame] = useState<SessionState | null>(null)
  const [activeGameSessionId, setActiveGameSessionId] = useState<string | null>(null)
  const [name] = useState('Tyler')
  const [joinCode, setJoinCode] = useState('')
  const [lobbyCode, setLobbyCode] = useState('CROW-7K2P')
  const [activeLobbyId, setActiveLobbyId] = useState<string | null>(null)
  const [activeLobbyHostId, setActiveLobbyHostId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [timer, setTimer] = useState(30)
  const [winningScore, setWinningScore] = useState(500)
  const [seats, setSeats] = useState<LobbySeat[]>([
    { id: 'you', name: 'You', status: 'human', team: 'A' },
    { id: 'mike', name: 'Mike', status: 'human', team: 'B' },
    { id: 'seat-3', name: 'Open seat', status: 'open', team: 'A' },
    { id: 'seat-4', name: 'Open seat', status: 'open', team: 'B' },
  ])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])
  const filled = seats.filter((seat) => seat.status !== 'open').length
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const makeAi = async (id: string) => {
    if (activeLobbyId && session?.user && session.user.id === activeLobbyHostId) {
      try { setSeats(await addAiSeat(activeLobbyId, session.user.id, id)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to add Crow AI.') }
      return
    }
    if (!activeLobbyId) setSeats((current) => current.map((seat) => seat.id === id ? { ...seat, name: 'Crow AI', status: 'ai', difficulty: 'Average' } : seat))
  }
  const setDifficulty = (id: string, difficulty: Difficulty) => setSeats((current) => current.map((seat) => seat.id === id ? { ...seat, difficulty } : seat))
  const displaySeats = useMemo(() => seats.map((seat, index) => ({ ...seat, color: avatarColors[index] })), [seats])

  useEffect(() => {
    if (!session?.user) return
    ensureProfile(session.user.id, session.user.email).catch((error) => showToast(error.message))
  }, [session])

  useEffect(() => {
    if (!session?.user) return
    getPlayerStatistics(session.user.id).then(setPlayerStats).catch(() => undefined)
  }, [session, view])

  useEffect(() => {
    const client = supabase
    if (!client || !activeLobbyId) return
    const refreshMembers = async () => {
      try {
        setSeats(await getLobbySnapshot(activeLobbyId))
        const started = await getActiveGameSession(activeLobbyId)
        if (started && !activeGame) {
          setActiveGameSessionId(started.id)
          setActiveGame(started.game_state)
          setView('game')
        }
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to refresh the lobby.') }
    }
    refreshMembers()
    const onLobbyChange = (payload: { new?: { status?: string } }) => {
      refreshMembers()
      if (payload.new?.status === 'in_progress') {
        getActiveGameSession(activeLobbyId).then((sessionState) => {
          if (sessionState) { setActiveGameSessionId(sessionState.id); setActiveGame(sessionState.game_state); setView('game') }
        }).catch((error) => showToast(error.message))
      }
    }
    const channel = client.channel(`lobby-${activeLobbyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${activeLobbyId}` }, refreshMembers)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${activeLobbyId}` }, onLobbyChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: activeGameSessionId ? `id=eq.${activeGameSessionId}` : 'id=eq.none' }, (payload) => {
        setActiveGame(payload.new.game_state as SessionState)
      })
      .subscribe()
    const refreshTimer = window.setInterval(refreshMembers, 1500)
    return () => { window.clearInterval(refreshTimer); client.removeChannel(channel) }
  }, [activeLobbyId, activeGameSessionId, activeGame])

  useEffect(() => {
    const hand = activeGame?.hand
    if (!activeGame || !hand || !activeGameSessionId || !session?.user || session.user.id !== activeLobbyHostId || !['bidding', 'trump', 'kitty', 'playing'].includes(hand.phase)) return
    const currentPlayer = activeGame.players[hand.currentPlayerIndex]
    if (!currentPlayer?.isAi) return
    const aiTimer = window.setTimeout(() => {
      const action = hand.phase === 'bidding'
        ? submitBid(activeGameSessionId, activeGame, currentPlayer.id, chooseAiBid(currentPlayer.hand, hand.currentBid, currentPlayer, activeGame.players, hand))
        : hand.phase === 'trump'
          ? submitTrump(activeGameSessionId, activeGame, currentPlayer.id, chooseAiTrump(currentPlayer.hand))
          : hand.phase === 'kitty'
            ? submitDiscard(activeGameSessionId, activeGame, currentPlayer.id, chooseAiDiscard(currentPlayer.hand))
            : submitCard(activeGameSessionId, activeGame, currentPlayer.id, chooseAiCardWithKnowledge(currentPlayer.hand, buildHandKnowledge(hand.tricks[hand.tricks.length - 1]?.cards.length === 4 ? undefined : hand.tricks[hand.tricks.length - 1], hand.trumpColor, activeGame.players.find((player) => player.id === hand.bidderId), hand.tricks[hand.tricks.length - 1]?.cards.length === 4 ? hand.tricks : hand.tricks.slice(0, -1)), currentPlayer, activeGame.players.find((player) => player.id === hand.bidderId), activeGame.players).id)
      action.then((nextState) => setActiveGame(nextState)).catch((error) => showToast(error instanceof Error ? error.message : 'Crow AI could not complete its turn.'))
    }, hand.phase === 'playing' && hand.tricks[hand.tricks.length - 1]?.cards.length === 4 && hand.tricks[hand.tricks.length - 1]?.visibleUntil ? Math.max(500, hand.tricks[hand.tricks.length - 1].visibleUntil! - Date.now()) : 500)
    return () => window.clearTimeout(aiTimer)
  }, [activeGame, activeGameSessionId, activeLobbyHostId, session])

  useEffect(() => {
    if (!activeGame || !activeGameSessionId || activeGame.status === 'completed' || activeGame.hand?.phase !== 'complete' || !session?.user || session.user.id !== activeLobbyHostId) return
    const nextStarter = activeGame.players[activeGame.hand.biddingPlayerIndex]
    if (!nextStarter?.isAi) return
    const timer = window.setTimeout(() => {
      dealNextHand(activeGameSessionId, activeGame).then((nextState) => setActiveGame(nextState)).catch((error) => showToast(error instanceof Error ? error.message : 'Crow AI could not deal the next hand.'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [activeGame, activeGameSessionId, activeLobbyHostId, session])

  const startLobby = async () => {
    if (!session?.user) return setView('lobby')
    try {
      await ensureProfile(session.user.id, session.user.email)
      const lobby = await createLobby(session.user.id)
      setLobbyCode(lobby.join_code)
      setActiveLobbyId(lobby.id)
      setActiveLobbyHostId(lobby.host_id)
      setView('lobby')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to create the lobby.') }
  }

  const enterLobby = async () => {
    if (!session?.user) return showToast('Sign in before joining a lobby.')
    try {
      await ensureProfile(session.user.id, session.user.email)
      const lobby = await findLobbyByCode(joinCode)
      const members = await joinLobby(lobby.id, session.user.id)
      setSeats(membersToSeats(members))
      setLobbyCode(lobby.join_code)
      setActiveLobbyId(lobby.id)
      setActiveLobbyHostId(lobby.host_id)
      setView('lobby')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to join the lobby.') }
  }

  const startGame = async () => {
    if (!activeLobbyId || !activeLobbyHostId || !session?.user) return showToast('Only the table leader can start the game.')
    try {
      const started = await startGameSession(activeLobbyId, session.user.id, seats, timer, winningScore)
      setActiveGameSessionId(started.id)
      setActiveGame(started.game_state)
      setView('game')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to start the game.') }
  }

  if (authLoading) return <div className="auth-loading">Loading your table…</div>
  if (isSupabaseConfigured && !session) return <AuthScreen />

  if (view === 'game' && activeGame) return <GameScreen game={activeGame} sessionId={activeGameSessionId} currentUserId={session?.user.id} isHost={session?.user.id === activeLobbyHostId} onRematch={async () => { if (!activeGameSessionId || !activeLobbyId) return; try { setActiveGame(await rematchSession(activeGameSessionId, activeLobbyId, activeGame)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to start the rematch.') } }} onCloseLobby={async () => { if (!activeLobbyId || !session?.user.id) return; try { await closeLobby(activeLobbyId, session.user.id); setView('home') } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to close the lobby.') } }} onNextHand={async () => { if (!activeGameSessionId || !session?.user.id) return; try { setActiveGame(await dealNextHand(activeGameSessionId, activeGame)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to deal the next hand.') } }} onBid={async (amount) => { if (!activeGameSessionId || !session?.user.id) return; try { setActiveGame(await submitBid(activeGameSessionId, activeGame, session.user.id, amount)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to submit bid.') } }} onTrump={async (color) => { if (!activeGameSessionId || !session?.user.id) return; try { setActiveGame(await submitTrump(activeGameSessionId, activeGame, session.user.id, color)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to choose trump.') } }} onDiscard={async (cardIds) => { if (!activeGameSessionId || !session?.user.id) return; try { setActiveGame(await submitDiscard(activeGameSessionId, activeGame, session.user.id, cardIds)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to discard those cards.') } }} onCard={async (cardId) => { if (!activeGameSessionId || !session?.user.id) return; try { setActiveGame(await submitCard(activeGameSessionId, activeGame, session.user.id, cardId)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to play that card.') } }} onBack={() => setView('lobby')} />
  if (view === 'lobby') return <Lobby code={lobbyCode} seats={displaySeats} timer={timer} setTimer={setTimer} winningScore={winningScore} setWinningScore={setWinningScore} onSettingsChange={async (nextScore) => { if (!activeLobbyId || !session?.user.id) return; try { setWinningScore((await updateLobbySettings(activeLobbyId, session.user.id, { turnTimer: timer, winningScore: nextScore })).winningScore) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update the winning score.') } }} makeAi={makeAi} setDifficulty={setDifficulty} hostId={activeLobbyHostId} currentUserId={session?.user.id} onBack={() => setView('home')} onStart={startGame} filled={filled} />

  return <main className="app-shell">
    {toast && <div className="toast">{toast}</div>}
    <header className="topbar"><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className={`status-dot ${isSupabaseConfigured ? 'online' : ''}`} /> {isSupabaseConfigured ? 'Connected' : 'Demo mode'} <button className="profile-button" onClick={() => supabase?.auth.signOut()}><Avatar label={session?.user.email ?? name} color="gold" /> <span>{session?.user.email ?? name}</span>⌄</button></div></header>
    <section className="hero"><div className="hero-copy"><p className="eyebrow">A better seat at the table</p><h1>Bring your people.<br /><em>Deal the cards.</em></h1><p className="hero-text">A cozy place for family games, friendly rivalries, and one more hand before bed.</p><div className="hero-actions"><button className="button primary" onClick={startLobby}>Create a private table <span>→</span></button><label className="join-field"><span>Have a code?</span><input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="CROW-XXXX" /><button onClick={() => joinCode ? enterLobby() : showToast('Enter a table code first.')}>Join</button></label></div></div><div className="hero-art"><div className="sun" /><div className="card card-back"><div className="card-pattern">C</div></div><div className="card card-front"><span className="card-corner">14<br /><i>red</i></span><span className="card-number">14</span><span className="card-corner bottom">14<br /><i>red</i></span></div><span className="sparkle one">✦</span><span className="sparkle two">✦</span></div></section>
    <section className="content-grid"><div className="panel welcome-panel"><div className="panel-heading"><div><p className="eyebrow">Your table</p><h2>Ready when you are</h2></div><span className="pill">New</span></div><div className="empty-table"><div className="mini-cards"><span>14</span><span>10</span><span>R</span></div><p>Create a private table and invite<br />your family with a simple code.</p><button className="text-button" onClick={startLobby}>Start a new table <span>→</span></button></div></div><div className="panel stats-panel"><div className="panel-heading"><div><p className="eyebrow">Your record</p><h2>At a glance</h2></div><button className="icon-button">↗</button></div><div className="stat-grid"><div><strong>{playerStats?.games_won ?? '—'}</strong><span>Games won</span></div><div><strong>{playerStats && playerStats.games_completed ? `${Math.round((playerStats.games_won / playerStats.games_completed) * 100)}%` : '—'}</strong><span>Win rate</span></div><div><strong>{playerStats?.hands_played ?? '—'}</strong><span>Hands played</span></div></div><p className="muted-note">Stats count completed player-only games.</p></div></section>
    <footer><span>Rieman family table · Built for the long haul</span><span>Rieman Rules · 4 players</span></footer>
  </main>
}

function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'sign-up') setMessage('Check your email to confirm your account, then come back to sign in.')
  }

  return <main className="auth-shell"><div className="auth-decoration"><span>10</span><span>14</span><span>C</span></div><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><p className="eyebrow">Your family table</p><h1>{mode === 'sign-in' ? 'Welcome back.' : 'Join the table.'}</h1><p className="auth-copy">{mode === 'sign-in' ? 'Sign in to find your tables and keep your stats.' : 'Create an account to play with family and keep your record.'}</p><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label>{message && <p className="auth-message">{message}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Working…' : mode === 'sign-in' ? 'Sign in →' : 'Create account →'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>{mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></section></main>
}

function LegacyLobby({ code, seats, timer, setTimer, makeAi, setDifficulty, onBack, onStart, filled }: { code: string; seats: (LobbySeat & { color: string })[]; timer: number; setTimer: (value: number) => void; makeAi: (id: string) => void; setDifficulty: (id: string, difficulty: Difficulty) => void; onBack: () => void; onStart: () => void; filled: number }) {
  return <main className="app-shell lobby-shell"><header className="topbar"><button className="back-button" onClick={onBack}>← <span>Home</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className="status-dot" /> Private table</div></header><section className="lobby-header"><div><p className="eyebrow">Private table</p><h1>Gather your crows.</h1><p>Choose your seats, then start when everyone is ready.</p></div><div className="code-card"><span>JOIN CODE</span><strong>{code}</strong><button onClick={() => navigator.clipboard?.writeText(code)}>Copy code</button></div></section><section className="lobby-layout"><div className="panel seats-panel"><div className="panel-heading"><div><p className="eyebrow">The table</p><h2>{filled}/4 players ready</h2></div><span className="live-pill"><i /> Waiting</span></div><div className="seats-grid">{seats.map((seat) => <div className={`seat-card ${seat.status}`} key={seat.id}><div className="seat-top"><Avatar label={seat.name} color={seat.color} /><span className={`seat-badge team-${seat.team}`}>Team {seat.team}</span></div><strong>{seat.name}</strong>{seat.status === 'human' && seat.id === 'you' && <span className="seat-meta">That’s you · Host</span>}{seat.status === 'human' && seat.id !== 'you' && <span className="seat-meta">Connected</span>}{seat.status === 'open' && <><span className="seat-meta">Waiting for a player</span><button className="seat-action" onClick={() => makeAi(seat.id)}>Fill with AI +</button></>}{seat.status === 'ai' && <><span className="seat-meta">AI opponent</span><select value={seat.difficulty} onChange={(e) => setDifficulty(seat.id, e.target.value as Difficulty)}><option>Newbie</option><option>Average</option><option>Skilled</option></select></>}</div>)}</div><div className="team-note"><span>●</span><p>Teams are assigned by the host. Team A and Team B will alternate partner positions around the table.</p></div></div><aside className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">Table settings</p><h2>Rieman Rules</h2></div><span className="rules-icon">R</span></div><div className="setting"><span>Ruleset</span><strong>Rieman Rules <small>500 points</small></strong></div><div className="setting"><span>Turn timer</span><div className="stepper"><button onClick={() => setTimer(Math.max(10, timer - 5))}>−</button><strong>{timer}s</strong><button onClick={() => setTimer(Math.min(120, timer + 5))}>+</button></div></div><div className="rule-summary"><strong>Quick rules</strong><p>Crow is always trump · 110 points per hand · Dealer takes 65 if all pass.</p></div><button className="button primary full" disabled={seats.some((s) => s.status === 'open')} onClick={onStart}>Start the game <span>→</span></button><p className="small-help">Everyone can rejoin if they disconnect. The host can’t remove players once the game begins.</p></aside></section></main>
}

function Lobby({ code, seats, timer, setTimer, winningScore, setWinningScore, onSettingsChange, makeAi, setDifficulty, hostId, currentUserId, onBack, onStart, filled }: { code: string; seats: (LobbySeat & { color: string })[]; timer: number; setTimer: (value: number) => void; winningScore: number; setWinningScore: (value: number) => void; onSettingsChange: (value: number) => void; makeAi: (id: string) => void; setDifficulty: (id: string, difficulty: Difficulty) => void; hostId: string | null; currentUserId?: string; onBack: () => void; onStart: () => void; filled: number }) {
  const isHost = Boolean(hostId && currentUserId === hostId)
  const host = seats.find((seat) => seat.id === hostId)
  const canStart = isHost && !seats.some((seat) => seat.status === 'open')
  return <main className="app-shell lobby-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}>← <span>Home</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className="status-dot" /> Private table</div></header>
    <section className="lobby-header"><div><p className="eyebrow">Private table</p><h1>Gather your crows.</h1><p>Choose your seats, then start when everyone is ready.</p></div><div className="code-card"><span>JOIN CODE</span><strong>{code}</strong><button onClick={() => navigator.clipboard?.writeText(code)}>Copy code</button></div></section>
    <section className="lobby-layout"><div className="panel seats-panel"><div className="panel-heading"><div><p className="eyebrow">The table</p><h2>{filled}/4 players ready</h2><p className="host-line">Leader: <strong>{host?.name ?? 'Table host'}</strong>{isHost ? ' · You' : ''}</p></div><span className="live-pill"><i /> Waiting</span></div><div className="seats-grid">{seats.map((seat) => <div className={`seat-card ${seat.status}`} key={seat.id}><div className="seat-top"><Avatar label={seat.name} color={seat.color} /><span className={`seat-badge team-${seat.team}`}>Team {seat.team}</span></div><strong>{seat.name}</strong>{seat.id === hostId && <span className="host-badge">Table leader</span>}{seat.status === 'human' && seat.id !== hostId && <span className="seat-meta">Connected</span>}{seat.status === 'human' && seat.id === currentUserId && <span className="seat-meta">That’s you</span>}{seat.status === 'open' && <><span className="seat-meta">Waiting for a player</span>{isHost && <button className="seat-action" onClick={() => makeAi(seat.id)}>Fill with AI +</button>}</>}{seat.status === 'ai' && <><span className="seat-meta">AI opponent</span>{isHost ? <select value={seat.difficulty} onChange={(e) => setDifficulty(seat.id, e.target.value as Difficulty)}><option>Newbie</option><option>Average</option><option>Skilled</option></select> : <span className="seat-meta">Set by the leader</span>}</>}</div>)}</div><div className="team-note"><span>●</span><p>{isHost ? 'You are the table leader. AI seats and game start are under your control.' : `The table leader is ${host?.name ?? 'the host'}. They control AI seats and start the game.`}</p></div></div><aside className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">Table settings</p><h2>Rieman Rules</h2></div><span className="rules-icon">R</span></div><div className="setting"><span>Ruleset</span><strong>Rieman Rules <small>500 points</small></strong></div><div className="setting"><span>Winning score</span><div className="stepper"><button disabled={!isHost} onClick={() => { const next = Math.max(250, winningScore - 50); setWinningScore(next); onSettingsChange(next) }}>−</button><strong>{winningScore}</strong><button disabled={!isHost} onClick={() => { const next = Math.min(1000, winningScore + 50); setWinningScore(next); onSettingsChange(next) }}>+</button></div></div><div className="setting"><span>Turn timer</span><div className="stepper"><button disabled={!isHost} onClick={() => setTimer(Math.max(10, timer - 5))}>−</button><strong>{timer}s</strong><button disabled={!isHost} onClick={() => setTimer(Math.min(120, timer + 5))}>+</button></div></div><div className="rule-summary"><strong>Quick rules</strong><p>Crow is always trump · 110 points per hand · Dealer takes 65 if all pass.</p></div><button className="button primary full" disabled={!canStart} onClick={onStart}>{isHost ? 'Start the game' : 'Waiting for the leader'} <span>→</span></button><p className="small-help">Everyone can rejoin if they disconnect. Only the table leader can change seats or start the game.</p></aside></section>
  </main>
}

function GameScreen({ game, sessionId, currentUserId, isHost, onRematch, onCloseLobby, onNextHand, onBid, onTrump, onDiscard, onCard, onBack }: { game: SessionState; sessionId: string | null; currentUserId?: string; isHost: boolean; onRematch: () => void; onCloseLobby: () => void; onNextHand: () => void; onBid: (amount: number | null) => void; onTrump: (color: CardColor) => void; onDiscard: (cardIds: string[]) => void; onCard: (cardId: string) => void; onBack: () => void }) {
  const [selectedDiscard, setSelectedDiscard] = useState<string[]>([])
  const currentPlayer = game.players[game.hand?.currentPlayerIndex ?? 0]
  const me = game.players.find((player) => player.id === currentUserId)
  const bidder = game.players.find((player) => player.id === game.hand?.bidderId)
  const isMyTurn = currentPlayer?.id === currentUserId
  const isBidder = bidder?.id === currentUserId
  const dealer = game.players[game.hand?.dealerIndex ?? 0]
  const nextHandStarter = game.players[game.hand?.biddingPlayerIndex ?? 0]
  const canDealNextHand = nextHandStarter?.id === currentUserId
  const bidOptions = Array.from({ length: 10 }, (_, index) => 65 + index * 5).filter((bid) => bid > (game.hand?.currentBid ?? 0))
  const availableTrumpColors = (['black', 'red', 'yellow', 'green'] as CardColor[]).filter((color) => bidder?.hand.some((card) => card.kind === 'number' && card.color === color))
  const activeTrick = game.hand?.tricks[game.hand.tricks.length - 1]?.cards.length === 4 ? undefined : game.hand?.tricks[game.hand.tricks.length - 1]
  const lastTrick = [...(game.hand?.tricks ?? [])].reverse().find((trick) => trick.cards.length === 4)
  const tableTrick = game.hand?.tricks[game.hand.tricks.length - 1]
  const latestBids = new Map((game.hand?.bids ?? []).map((bid, index, bids) => [bid.playerId, { ...bid, index }]))
  const leadColor = leadColorForTrick(activeTrick, game.hand?.trumpColor)
  const legalCardIds = new Set((me?.hand ?? []).filter((card) => canPlayCard(me?.hand ?? [], card, leadColor, game.hand?.trumpColor)).map((card) => card.id))
  const toggleDiscard = (card: Card) => { if (card.kind === 'crow' || (card.kind === 'number' && [5, 10, 14].includes(card.value))) return; setSelectedDiscard((selected) => selected.includes(card.id) ? selected.filter((id) => id !== card.id) : selected.length < 5 ? [...selected, card.id] : selected) }
  const phaseTitle = game.hand?.phase === 'bidding' ? 'Make your bid.' : game.hand?.phase === 'trump' ? 'Choose trump.' : game.hand?.phase === 'kitty' ? 'Discard the kitty.' : 'The hand is live.'
  return <main className="app-shell game-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}>← <span>Lobby</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className="status-dot online" /> Live table</div></header>
    <section className="game-header"><div><p className="eyebrow">Rieman Rules · Hand {game.handNumber + 1}</p><h1>{phaseTitle}</h1><p>{game.hand?.phase === 'bidding' ? (isMyTurn ? 'It’s your turn to bid' : `${currentPlayer?.name ?? 'A player'} is bidding`) : game.hand?.phase === 'trump' ? `${bidder?.name ?? 'The winning bidder'} won the bid` : game.hand?.phase === 'kitty' ? `${bidder?.name ?? 'The winning bidder'} is choosing the discard` : 'Clockwise play has begun'}</p></div><div className="scoreboard"><div><span>Team A</span><strong>{game.scores.A}</strong></div><div><span>Team B</span><strong>{game.scores.B}</strong></div></div></section>
    {game.hand?.phase === 'bidding' && <div className="bid-banner bidding-banner"><strong>Current bid: {game.hand.currentBid ?? 'No bids yet'}</strong><span>{currentPlayer?.name ?? 'Player'} is up · bidding in progress</span></div>}
    {game.hand?.bidderId && game.hand.phase !== 'bidding' && <div className={`bid-banner trump-banner ${game.hand.trumpColor ? `trump-${game.hand.trumpColor}` : ''}`}><strong>Team {bidder?.team} won the bid</strong><span>Bid: {game.hand.currentBid} · {game.hand.trumpColor ? `Trump: ${game.hand.trumpColor}` : 'Choosing trump'}</span></div>}
    {game.hand?.phase === 'complete' && <div className={`result-banner ${game.hand.bidMade ? '' : 'failed-bid'}`}><strong>{game.hand.bidMade ? `Team ${game.hand.bidderTeam} made the bid` : `Team ${game.hand.bidderTeam} failed the bid`}</strong><span>Bid {game.hand.currentBid} · Captured {game.hand.teamPoints?.[game.hand.bidderTeam ?? 'A'] ?? 0} · Score {game.hand.scoreDelta?.[game.hand.bidderTeam ?? 'A'] ?? 0}</span></div>}
    {game.hand?.phase !== 'bidding' && <div className="hand-points"><span>Hand points</span><strong>Team A {capturedPointsForTeam(game, 'A')}</strong><strong>Team B {capturedPointsForTeam(game, 'B')}</strong><small>of 110</small></div>}
    <section className="game-board"><div className={`table-center ${game.hand?.trumpColor ? `table-trump-${game.hand.trumpColor}` : ''}`}><p className="turn-label">{game.hand?.phase === 'bidding' ? 'Bidding' : 'Winning bid'}</p><strong>{game.hand?.phase === 'bidding' ? game.hand.currentBid ?? 'No bid' : `Team ${bidder?.team ?? '—'}`}</strong><small>{game.hand?.phase === 'bidding' ? `${currentPlayer?.name ?? 'Player'} is up` : `${game.hand?.currentBid ?? '—'} points · ${game.hand?.trumpColor ? `Trump: ${game.hand.trumpColor}` : 'Trump pending'}`}</small></div><TableCards trick={tableTrick} players={game.players} />{game.players.map((player, index) => { const bid = latestBids.get(player.id); return <div className={`player-position player-${index} ${player.id === currentUserId ? 'is-you' : ''}`} key={player.id}><Avatar label={player.name} color={avatarColors[index]} />{player.id === dealer?.id && <span className="dealer-chip">Dealer</span>}<span>{player.name}{player.id === currentUserId ? ' · You' : ''}</span><small>Team {player.team}{player.isAi ? ' · AI' : ''}</small>{game.hand?.phase === 'bidding' && <span className={`table-bid-status ${player.id === currentPlayer?.id ? 'bidding-now' : ''}`}>{player.id === currentPlayer?.id && 'Bidding'}{player.id !== currentPlayer?.id && bid && (bid.passed ? 'Passed' : `Bid ${bid.amount}`)}{player.id !== currentPlayer?.id && !bid && 'Not bid'}</span>}</div> })}</section>
    {game.hand?.phase === 'trump' && <section className="action-panel"><p className="eyebrow">Trump selection</p><h2>{isBidder ? 'Which color will be trump?' : `${bidder?.name ?? 'The winning bidder'} is choosing trump`}</h2>{isBidder ? <div className="color-actions">{availableTrumpColors.map((color) => <button className={`color-choice color-${color}`} key={color} onClick={() => onTrump(color)}>{color}</button>)}</div> : <p className="muted-note">The winning bidder chooses a color they still hold.</p>}</section>}
    <section className="hand-panel"><div className="hand-heading"><div><p className="eyebrow">Your hand</p><h2>{me?.hand.length ?? 0} cards</h2></div>{game.hand?.phase === 'bidding' && <span className="bid-status">{isMyTurn ? 'Choose a bid' : `Waiting for ${currentPlayer?.name ?? 'player'}`}</span>}{game.hand?.phase === 'kitty' && isBidder && <span className="bid-status">{selectedDiscard.length}/5 selected</span>}{game.hand?.phase === 'playing' && <span className="bid-status">{isMyTurn ? 'Choose a legal card' : `Waiting for ${currentPlayer?.name ?? 'player'}`}</span>}</div><div className="hand-cards">{sortHand(me?.hand ?? []).map((card) => <CardView key={card.id} card={card} selected={selectedDiscard.includes(card.id)} onClick={game.hand?.phase === 'kitty' && isBidder ? () => toggleDiscard(card) : game.hand?.phase === 'playing' && isMyTurn && legalCardIds.has(card.id) ? () => onCard(card.id) : undefined} />)}</div>{game.hand?.phase === 'bidding' && <div className="bid-controls"><button className="pass-button" disabled={!isMyTurn} onClick={() => onBid(null)}>Pass</button><div className="bid-options">{bidOptions.map((bid) => <button key={bid} disabled={!isMyTurn} onClick={() => onBid(bid)}>{bid}</button>)}</div></div>}{game.hand?.phase === 'kitty' && isBidder && <button className="button primary discard-button" disabled={selectedDiscard.length !== 5} onClick={() => { onDiscard(selectedDiscard); setSelectedDiscard([]) }}>Discard selected cards →</button>}</section>
    {(game.hand?.phase === 'playing' || game.hand?.phase === 'complete') && <TrickPanel trick={lastTrick} players={game.players} completed />}
    {game.hand?.phase === 'complete' && game.status === 'completed' && <GameResult game={game} currentUserId={currentUserId} isHost={isHost} onRematch={onRematch} onCloseLobby={onCloseLobby} />}
    {game.hand?.phase === 'complete' && game.status !== 'completed' && <section className="next-hand-panel"><div><p className="eyebrow">Hand complete</p><h2>Scores: Team A {game.scores.A} · Team B {game.scores.B}</h2></div>{canDealNextHand && <button className="button primary" onClick={onNextHand}>Deal next hand →</button>}{!canDealNextHand && <p className="muted-note">Waiting for {nextHandStarter?.name ?? 'the next dealer'} to deal the next hand.</p>}</section>}
    <div className="game-note"><span className="rules-icon">R</span><p>{sessionId ? 'Game state is saved and synchronized with everyone at the table.' : 'Connecting this table to the active session…'}</p></div>
  </main>
}

function TrickPanel({ trick, players, completed }: { trick?: { cards: Array<{ playerId: string; card: Card }>; winnerId?: string }; players: SessionState['players']; completed: boolean }) {
  return <section className="trick-panel"><div><p className="eyebrow">{completed ? 'Last trick' : 'Current trick'}</p><h2>{trick?.cards.length ?? 0}/4 cards played</h2></div><div className="trick-cards">{trick?.cards.map(({ playerId, card }) => <div className="trick-card" key={`${playerId}-${card.id}`}><CardView card={card} /><small>{players.find((player) => player.id === playerId)?.name ?? 'Player'}</small></div>)}</div>{trick?.winnerId && <p className="trick-winner">Trick won by {players.find((player) => player.id === trick.winnerId)?.name ?? 'player'}{completed ? ' · next lead' : ''}</p>}</section>
}

function GameResult({ game, currentUserId, isHost, onRematch, onCloseLobby }: { game: SessionState; currentUserId?: string; isHost: boolean; onRematch: () => void; onCloseLobby: () => void }) {
  const myTeam = game.players.find((player) => player.id === currentUserId)?.team
  const won = myTeam === game.hand?.gameWinner
  const confetti = createConfetti()
  return <section className={`game-result ${won ? 'game-won' : 'game-lost'}`}>{won && <div className="confetti" aria-hidden>{confetti.map((piece) => <i key={piece.id} style={{ left: piece.left, animationDelay: piece.delay, background: piece.color, transform: `rotate(${piece.rotation})` }} />)}</div>}<div className="result-icon">{won ? '★' : '○'}</div><p className="eyebrow">Game complete</p><h2>Team {game.hand?.gameWinner} wins</h2><p>{won ? 'You took the table. Nice work.' : 'The cards had other plans this time.'}</p>{isHost ? <div className="result-actions"><button className="button primary" onClick={onRematch}>Rematch →</button><button className="secondary-button" onClick={onCloseLobby}>Close lobby</button></div> : <p className="muted-note">Waiting for the table leader to choose a rematch or close the lobby.</p>}</section>
}

function TableCards({ trick, players }: { trick?: { cards: Array<{ playerId: string; card: Card }> }; players: SessionState['players'] }) {
  if (!trick?.cards.length) return <div className="table-empty">Cards played this trick will appear here.</div>
  return <div className="table-cards"><p className="table-label">Table · current trick</p>{trick.cards.map(({ playerId, card }) => { const playerIndex = players.findIndex((player) => player.id === playerId); return <div className={`table-card-play table-card-position-${playerIndex}`} key={`${playerId}-${card.id}`}><CardView card={card} /></div> })}</div>
}

function BidHistory({ game, currentPlayerId }: { game: SessionState; currentPlayerId?: string }) {
  const bids = game.hand?.bids ?? []
  const passedPlayers = new Set(bids.filter((bid) => bid.passed).map((bid) => bid.playerId))
  return <section className="bid-history"><div className="history-heading"><div><p className="eyebrow">Bidding</p><h2>Current bid: {game.hand?.currentBid ?? '—'}</h2></div><span>{passedPlayers.size} passed · {game.players.length - passedPlayers.size} eligible</span></div><div className="bid-players">{game.players.map((player, index) => { const latest = [...bids].reverse().find((bid) => bid.playerId === player.id); return <div className={`bid-player ${player.id === currentPlayerId ? 'active' : ''}`} key={player.id}><Avatar label={player.name} color={avatarColors[index]} /><div><strong>{player.name}{player.id === currentPlayerId ? ' · Up now' : ''}</strong><small>{latest ? latest.passed ? 'Passed — out this hand' : `Bid ${latest.amount}` : 'Not bid yet'}</small></div></div> })}</div></section>
}

function CardView({ card, selected, onClick }: { card: Card; selected?: boolean; onClick?: () => void }) {
  if (card.kind === 'crow') return <div className={`playing-card crow-card ${selected ? 'selected' : ''} ${onClick ? 'playable' : ''}`} onClick={onClick}><strong>C</strong><small>Crow</small></div>
  return <div className={`playing-card color-${card.color} ${selected ? 'selected' : ''} ${onClick ? 'playable' : ''}`} onClick={onClick}><strong>{card.value}</strong><small>{card.color}</small></div>
}

function sortHand(hand: Card[]) {
  const colorOrder = ['black', 'red', 'yellow', 'green']
  return [...hand].sort((left, right) => {
    if (left.kind === 'crow') return -1
    if (right.kind === 'crow') return 1
    const colorDifference = colorOrder.indexOf(left.color) - colorOrder.indexOf(right.color)
    return colorDifference || right.value - left.value
  })
}

export default App
