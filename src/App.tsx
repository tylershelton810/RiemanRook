import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { Difficulty, LobbySeat } from './lib/types'
import { addAiSeat, createLobby, ensureProfile, findLobbyByCode, getDisplayName, getLobbySnapshot, getLobbyMembers, getLobbyMemberFonts, getLobbyMemberLogos, getLobbyMemberPlacements, getMyLobbies, joinLobby, leaveLobby, membersToSeats, setAiSeatDifficulty, setDisplayName as saveDisplayName, swapSeats as swapLobbySeats, updateLobbyName, updateLobbySettings } from './services/lobbies'
import type { LobbySummary } from './services/lobbies'
import { getMyCrowLogo, getMyWallet, listCrowLogos, purchaseCrowLogo, setCrowLogo, crowLogoUrl } from './services/crowLogos'
import type { CrowLogoRecord, CrowWallet } from './services/crowLogos'
import { purchaseCardAnimation, setCardAnimation } from './services/cardAnimations'
import { purchasePlacement, setPlacement } from './services/placements'
import { purchaseCardFont, setCardFont } from './services/cardFonts'
import { BUILTIN_CROW_LOGOS } from './lib/crowLogos'
import { TOKENS_PER_CROW_FACE, isPaidCrowLogo, tokensForWinningScore } from './lib/tokens'
import { CARD_ANIMATIONS, COINS_PER_CARD_ANIMATION } from './lib/cardAnimations'
import { PLACEMENTS, COINS_PER_PLACEMENT } from './lib/placements'
import { CARD_FONTS, COINS_PER_CARD_FONT } from './lib/cardFonts'
import { closeLobby, dealNextHand, getActiveGameSession, getCurrentGameSession, getPlayerStatistics, persistLocalGame, reconcileAiSeats, rematchSession, startGameSession, submitBid, submitTrump, submitDiscard, submitCard } from './services/sessions'
import { createConfetti } from './game/celebration'
import type { Card, PlayerState, SessionState } from './game/types'
import type { CardColor } from './game/types'
import { buildHandKnowledge, chooseAiBid, chooseAiCardWithKnowledge, chooseAiTrump, planKitty } from './game/ai'
import { canPlayCard, leadColorForTrick } from './game/rules'
import { capturedPointsForTeam, chooseTrump, createSession, discardKitty, playCard, recordBid, resetSessionForRematch, startNextHand } from './game/session'

const avatarColors = ['coral', 'gold', 'sage', 'lavender']

function Avatar({ label, color = 'coral' }: { label: string; color?: string }) {
  return <span className={`avatar ${color}`}>{label.slice(0, 1).toUpperCase()}</span>
}

function teamLabel(team: 'A' | 'B', game: SessionState, currentUserId?: string) {
  const myTeam = game.players.find((player) => player.id === currentUserId)?.team
  if (!myTeam) return `Team ${team}`
  return myTeam === team ? 'Us' : 'Them'
}

type PlayerStatistics = {
  games_won: number
  games_lost: number
  games_unfinished: number
  games_completed: number
  hands_played: number
  hands_bid: number
  winning_bids: number
  favorite_colors: Record<string, number>
  favorite_partners: Record<string, number>
  ai_games_won: number
  ai_games_lost: number
  ai_games_unfinished: number
  ai_games_completed: number
  ai_hands_played: number
  ai_hands_bid: number
  ai_winning_bids: number
  ai_favorite_colors: Record<string, number>
  ai_favorite_partners: Record<string, number>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [playerStats, setPlayerStats] = useState<PlayerStatistics | null>(null)
  const [showStats, setShowStats] = useState(false)
  const [view, setView] = useState<'home' | 'lobby' | 'game' | 'settings'>('home')
  const [activeGame, setActiveGame] = useState<SessionState | null>(null)
  const [activeGameSessionId, setActiveGameSessionId] = useState<string | null>(null)
  const plannedTrumpRef = useRef<CardColor | null>(null)
  const suppressGameAutoJoinRef = useRef(false)
  const [name] = useState('Tyler')
  const [displayName, setDisplayName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [lobbyCode, setLobbyCode] = useState('CROW-7K2P')
  const [lobbyName, setLobbyName] = useState('')
  const [myLobbies, setMyLobbies] = useState<LobbySummary[]>([])
  const [activeLobbyId, setActiveLobbyId] = useState<string | null>(null)
  const [activeLobbyHostId, setActiveLobbyHostId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [timer, setTimer] = useState(30)
  const [winningScore, setWinningScore] = useState(500)
  const [localGame, setLocalGame] = useState(false)
  const [seats, setSeats] = useState<LobbySeat[]>([
    { id: 'you', name: 'You', status: 'human', team: 'A' },
    { id: 'seat-1', name: 'Open seat', status: 'open', team: 'B' },
    { id: 'seat-2', name: 'Open seat', status: 'open', team: 'A' },
    { id: 'seat-3', name: 'Open seat', status: 'open', team: 'B' },
  ])
  const [myCrowLogo, setMyCrowLogo] = useState<string | null>(null)
  const [crowLogoCatalog, setCrowLogoCatalog] = useState<CrowLogoRecord[]>([])
  const [crowLogosByPlayer, setCrowLogosByPlayer] = useState<Record<string, string | null>>({})
  const [placementsByPlayer, setPlacementsByPlayer] = useState<Record<string, string | null>>({})
  const [fontsByPlayer, setFontsByPlayer] = useState<Record<string, string | null>>({})
  const [wallet, setWallet] = useState<CrowWallet | null>(null)

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

  useEffect(() => {
    if (view !== 'home') return
    if (joinCode) setJoinCode('')
    if (lobbyName) setLobbyName('')
  }, [view])

  useEffect(() => {
    if (!session?.user) return
    Object.values(loadLocalGames()).forEach((record) => {
      if (record.hostId !== session.user?.id) return
      if (localGame && record.lobbyId === activeLobbyId) return
      flushLocalGame(record)
    })
  }, [session])
  const filled = seats.filter((seat) => seat.status !== 'open').length
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const LOCAL_GAMES_KEY = 'crow.localGames'
  const loadLocalGames = (): Record<string, { sessionId: string; lobbyId: string; hostId: string; state: SessionState }> => {
    try { return JSON.parse(localStorage.getItem(LOCAL_GAMES_KEY) ?? '{}') } catch { return {} }
  }
  const storeLocalGame = (lobbyId: string, record: { sessionId: string; lobbyId: string; hostId: string; state: SessionState }) => {
    try { const all = loadLocalGames(); all[lobbyId] = record; localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(all)) } catch { /* storage unavailable */ }
  }
  const dropLocalGame = (lobbyId: string) => {
    try { const all = loadLocalGames(); delete all[lobbyId]; localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(all)) } catch { /* storage unavailable */ }
  }
  const flushLocalGame = async (record: { sessionId: string; lobbyId: string; hostId: string; state: SessionState }) => {
    try { await persistLocalGame(record.lobbyId, record.hostId, record.state); dropLocalGame(record.lobbyId); return true } catch { return false }
  }
  const signOut = async () => {
    console.log('signing out')
    if (!supabase) return
    console.log('signing out supabase')
    Object.values(loadLocalGames()).forEach((record) => { if (record.hostId === session?.user?.id) flushLocalGame(record) })
    const { error } = await supabase.auth.signOut()
    if (error) showToast(`Sign out failed: ${error.message}`)
  }
  const handleChangeDisplayName = async (nextName: string) => {
    if (!session?.user) return
    try {
      setDisplayName(await saveDisplayName(session.user.id, nextName))
      showToast('Display name updated.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update your display name.') }
  }
  const makeAi = async (id: string) => {
    if (activeLobbyId && session?.user && session.user.id === activeLobbyHostId) {
      try { setSeats(await addAiSeat(activeLobbyId, session.user.id, id)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to add Crow AI.') }
      return
    }
    if (!activeLobbyId) setSeats((current) => current.map((seat) => seat.id === id ? { ...seat, name: 'Crow AI', status: 'ai', difficulty: 'Average' } : seat))
  }
  const setDifficulty = async (id: string, difficulty: Difficulty) => {
    if (activeLobbyId && session?.user && session.user.id === activeLobbyHostId) {
      try { setSeats(await setAiSeatDifficulty(activeLobbyId, session.user.id, id, difficulty)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update the AI difficulty.') }
      return
    }
    setSeats((current) => current.map((seat) => seat.id === id ? { ...seat, difficulty } : seat))
  }
  const swapSeats = async (firstId: string, secondId: string) => {
    if (!activeLobbyId || !session?.user || session.user.id !== activeLobbyHostId) return showToast('Only the table leader can move players.')
    try { setSeats(await swapLobbySeats(activeLobbyId, session.user.id, firstId, secondId)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to move that player.') }
  }
  const displaySeats = useMemo(() => seats.map((seat, index) => ({ ...seat, color: avatarColors[index] })), [seats])

  const rejoinLobby = async (lobby: LobbySummary, shouldAbort: () => boolean = () => false) => {
    try {
      suppressGameAutoJoinRef.current = false
      const pending = loadLocalGames()[lobby.id]
      if (pending && session?.user && pending.hostId === session.user.id) await flushLocalGame(pending)
      const recoveredSeats = await getLobbySnapshot(lobby.id)
      if (shouldAbort()) return
      setLobbyCode(lobby.join_code)
      setLobbyName(lobby.name ?? '')
      setActiveLobbyId(lobby.id)
      setActiveLobbyHostId(lobby.host_id)
      setSeats(recoveredSeats)
      setTimer(lobby.settings?.turnTimer ?? 30)
      setWinningScore(lobby.settings?.winningScore ?? 500)
      if (lobby.status === 'in_progress') {
        const currentSession = await getCurrentGameSession(lobby.id)
        if (shouldAbort()) return
        if (currentSession) {
          let gameState = currentSession.game_state
          if (session?.user && session.user.id === lobby.host_id && currentSession.status === 'active') {
            const reconciled = await reconcileAiSeats(lobby.id, lobby.host_id)
            if (shouldAbort()) return
            gameState = reconciled ?? gameState
          }
          setActiveGameSessionId(currentSession.id)
          setActiveGame(gameState)
          setView('game')
        } else {
          setView('lobby')
        }
      } else {
        setView('lobby')
      }
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to rejoin that table.') }
  }

  const leaveLobbyFor = async (lobby: LobbySummary) => {
    if (!session?.user) return
    try {
      await leaveLobby(lobby.id, session.user.id)
      setMyLobbies((current) => current.filter((item) => item.id !== lobby.id))
      if (activeLobbyId === lobby.id) {
        setActiveLobbyId(null)
        setActiveLobbyHostId(null)
        setActiveGameSessionId(null)
        setActiveGame(null)
      }
      showToast('You left the table.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to leave that table.') }
  }

  useEffect(() => {
    if (!session?.user) { setDisplayName(''); return }
    ensureProfile(session.user.id, session.user.email).catch((error) => showToast(error.message))
    getDisplayName(session.user.id).then(setDisplayName).catch(() => undefined)
  }, [session])

  useEffect(() => {
    if (!session?.user) return
    getMyCrowLogo(session.user.id).then(setMyCrowLogo).catch(() => undefined)
    listCrowLogos().then(setCrowLogoCatalog).catch(() => undefined)
  }, [session])

  useEffect(() => {
    if (!session?.user) return
    getMyWallet(session.user.id).then(setWallet).catch(() => undefined)
  }, [session, activeGame?.status])

  useEffect(() => {
    if (!session?.user || view !== 'home') return
    getMyLobbies(session.user.id).then(setMyLobbies).catch(() => undefined)
  }, [session, view, activeLobbyId])

  useEffect(() => {
    if (!session?.user) return
    getPlayerStatistics(session.user.id).then(setPlayerStats).catch(() => undefined)
  }, [session, view])

  useEffect(() => {
    const client = supabase
    if (!client || !activeLobbyId || localGame) return
    const refreshMembers = async () => {
      try {
        setSeats(await getLobbySnapshot(activeLobbyId))
        getLobbyMemberLogos(activeLobbyId).then(setCrowLogosByPlayer).catch(() => undefined)
        getLobbyMemberPlacements(activeLobbyId).then(setPlacementsByPlayer).catch(() => undefined)
        getLobbyMemberFonts(activeLobbyId).then(setFontsByPlayer).catch(() => undefined)
        const started = await getCurrentGameSession(activeLobbyId)
        if (started && !activeGame && !suppressGameAutoJoinRef.current) {
          setActiveGameSessionId(started.id)
          setActiveGame(started.game_state)
          setView('game')
        }
        if (started?.status === 'active' && session?.user && activeLobbyHostId && session.user.id === activeLobbyHostId) {
          const reconciled = await reconcileAiSeats(activeLobbyId, activeLobbyHostId)
          if (reconciled) {
            setActiveGameSessionId(started.id)
            setActiveGame(reconciled)
            if (!suppressGameAutoJoinRef.current) setView('game')
          }
        }
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to refresh the lobby.') }
    }
    refreshMembers()
    const onLobbyChange = (payload: { new?: { status?: string; host_id?: string; name?: string } }) => {
      if (payload.new?.host_id) setActiveLobbyHostId(payload.new.host_id)
      if (payload.new?.name) setLobbyName(payload.new.name)
      refreshMembers()
      if (payload.new?.status === 'in_progress') {
        getCurrentGameSession(activeLobbyId).then((sessionState) => {
          if (sessionState && !suppressGameAutoJoinRef.current) { setActiveGameSessionId(sessionState.id); setActiveGame(sessionState.game_state); setView('game') }
        }).catch((error) => showToast(error.message))
      }
    }
    const channel = client.channel(`lobby-${activeLobbyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${activeLobbyId}` }, refreshMembers)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${activeLobbyId}` }, onLobbyChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: activeGameSessionId ? `id=eq.${activeGameSessionId}` : 'id=eq.none' }, (payload) => {
        setActiveGame(payload.new.game_state as SessionState)
        if (!suppressGameAutoJoinRef.current) setView('game')
      })
      .subscribe()
    const refreshTimer = window.setInterval(refreshMembers, 1500)
    return () => { window.clearInterval(refreshTimer); client.removeChannel(channel) }
  }, [activeLobbyId, activeGameSessionId, activeGame, session, activeLobbyHostId, localGame])

  useEffect(() => {
    const hand = activeGame?.hand
    if (!activeGame || !hand || !activeGameSessionId || !session?.user || session.user.id !== activeLobbyHostId || !['bidding', 'trump', 'kitty', 'playing'].includes(hand.phase)) return
    const currentPlayer = activeGame.players[hand.currentPlayerIndex]
    if (!currentPlayer?.isAi) return
    const aiTimer = window.setTimeout(() => {
      const attempt = async () => {
        let next: SessionState
        if (localGame) {
          const clone = structuredClone(activeGame)
          if (hand.phase === 'bidding') {
            next = recordBid(clone, currentPlayer.id, chooseAiBid(currentPlayer.hand, hand.currentBid, currentPlayer, activeGame.players, hand))
          } else if (hand.phase === 'trump') {
            const planned = plannedTrumpRef.current ?? chooseAiTrump(currentPlayer.hand)
            plannedTrumpRef.current = null
            next = chooseTrump(clone, currentPlayer.id, planned)
          } else if (hand.phase === 'kitty') {
            const plan = planKitty(currentPlayer.hand)
            plannedTrumpRef.current = plan.trump
            next = discardKitty(clone, currentPlayer.id, plan.discardIds)
          } else {
            next = playCard(clone, currentPlayer.id, chooseAiCardWithKnowledge(currentPlayer.hand, buildHandKnowledge(hand.tricks[hand.tricks.length - 1]?.cards.length === 4 ? undefined : hand.tricks[hand.tricks.length - 1], hand.trumpColor, activeGame.players.find((player) => player.id === hand.bidderId), hand.tricks[hand.tricks.length - 1]?.cards.length === 4 ? hand.tricks : hand.tricks.slice(0, -1)), currentPlayer, activeGame.players.find((player) => player.id === hand.bidderId), activeGame.players).id)
          }
          setActiveGame(next)
          return
        }
        if (hand.phase === 'bidding') {
          next = await submitBid(activeGameSessionId, activeGame, currentPlayer.id, chooseAiBid(currentPlayer.hand, hand.currentBid, currentPlayer, activeGame.players, hand))
        } else if (hand.phase === 'trump') {
          const planned = plannedTrumpRef.current ?? chooseAiTrump(currentPlayer.hand)
          plannedTrumpRef.current = null
          next = await submitTrump(activeGameSessionId, activeGame, currentPlayer.id, planned)
        } else if (hand.phase === 'kitty') {
          const plan = planKitty(currentPlayer.hand)
          plannedTrumpRef.current = plan.trump
          next = await submitDiscard(activeGameSessionId, activeGame, currentPlayer.id, plan.discardIds)
        } else {
          next = await submitCard(activeGameSessionId, activeGame, currentPlayer.id, chooseAiCardWithKnowledge(currentPlayer.hand, buildHandKnowledge(hand.tricks[hand.tricks.length - 1]?.cards.length === 4 ? undefined : hand.tricks[hand.tricks.length - 1], hand.trumpColor, activeGame.players.find((player) => player.id === hand.bidderId), hand.tricks[hand.tricks.length - 1]?.cards.length === 4 ? hand.tricks : hand.tricks.slice(0, -1)), currentPlayer, activeGame.players.find((player) => player.id === hand.bidderId), activeGame.players).id)
        }
        setActiveGame(next)
      }
      attempt().catch((error) => showToast(error instanceof Error ? error.message : 'Crow AI could not complete its turn.'))
    }, hand.phase === 'playing' && hand.tricks[hand.tricks.length - 1]?.cards.length === 4 && hand.tricks[hand.tricks.length - 1]?.visibleUntil ? Math.max(500, hand.tricks[hand.tricks.length - 1].visibleUntil! - Date.now()) : 500)
    return () => window.clearTimeout(aiTimer)
  }, [activeGame, activeGameSessionId, activeLobbyHostId, session, localGame])

  useEffect(() => {
    if (!activeGame || !activeGameSessionId || activeGame.status === 'completed' || activeGame.hand?.phase !== 'complete' || !session?.user || session.user.id !== activeLobbyHostId) return
    const timer = window.setTimeout(() => {
      if (localGame) { setActiveGame(startNextHand(structuredClone(activeGame))); return }
      dealNextHand(activeGameSessionId, activeGame).then((nextState) => setActiveGame(nextState)).catch((error) => showToast(error instanceof Error ? error.message : 'Unable to deal the next hand.'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [activeGame, activeGameSessionId, activeLobbyHostId, session, localGame])

  useEffect(() => {
    if (!localGame || !activeGame || !activeLobbyId || !activeGameSessionId || !session?.user) return
    storeLocalGame(activeLobbyId, { sessionId: activeGameSessionId, lobbyId: activeLobbyId, hostId: session.user.id, state: activeGame })
  }, [localGame, activeGame, activeLobbyId, activeGameSessionId, session])

  useEffect(() => {
    if (!localGame || !activeGame || activeGame.status !== 'completed' || !activeLobbyId || !activeGameSessionId || !session?.user) return
    const record = loadLocalGames()[activeLobbyId]
    if (!record) return
    flushLocalGame(record)
  }, [localGame, activeGame?.status, activeLobbyId, activeGameSessionId, session])

  useEffect(() => {
    if (!localGame || !activeLobbyId) return
    getLobbyMemberLogos(activeLobbyId).then(setCrowLogosByPlayer).catch(() => undefined)
    getLobbyMemberPlacements(activeLobbyId).then(setPlacementsByPlayer).catch(() => undefined)
    getLobbyMemberFonts(activeLobbyId).then(setFontsByPlayer).catch(() => undefined)
  }, [localGame, activeLobbyId])

  const startLobby = async () => {
    if (!session?.user) return showToast('Sign in before creating a lobby.')
    try {
      suppressGameAutoJoinRef.current = false
      setActiveLobbyId(null)
      setActiveLobbyHostId(null)
      setActiveGameSessionId(null)
      setActiveGame(null)
      await ensureProfile(session.user.id, session.user.email)
      const lobby = await createLobby(session.user.id, lobbyName.trim())
      const snapshot = await getLobbySnapshot(lobby.id)
      setSeats(snapshot)
      setLobbyCode(lobby.join_code)
      setLobbyName(lobby.name)
      setActiveLobbyId(lobby.id)
      setActiveLobbyHostId(lobby.host_id)
      setTimer(lobby.settings?.turnTimer ?? 30)
      setWinningScore(lobby.settings?.winningScore ?? 500)
      setView('lobby')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to create the lobby.') }
  }

  const enterLobby = async () => {
    if (!session?.user) return showToast('Sign in before joining a lobby.')
    try {
      suppressGameAutoJoinRef.current = false
      await ensureProfile(session.user.id, session.user.email)
      const lobby = await findLobbyByCode(joinCode)
      const members = await joinLobby(lobby.id, session.user.id)
      setSeats(membersToSeats(members))
      setLobbyCode(lobby.join_code)
      setLobbyName(lobby.name ?? '')
      setActiveLobbyId(lobby.id)
      setActiveLobbyHostId(lobby.host_id)
      setView('lobby')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to join the lobby.') }
  }

  const startGame = async () => {
    suppressGameAutoJoinRef.current = false
    if (!activeLobbyId || !activeLobbyHostId || !session?.user) return showToast('Only the table leader can start the game.')
    if (seats.some((seat) => seat.status === 'open')) return showToast('Fill every seat before starting.')
    if (seats.filter((seat) => seat.status === 'human').every((seat) => seat.id === session.user?.id)) {
      const players: PlayerState[] = seats.map((seat) => ({ id: seat.id, name: seat.name, team: seat.team, hand: [], connected: true, isAi: seat.status === 'ai', difficulty: seat.difficulty }))
      const sessionId = crypto.randomUUID()
      const gameState: SessionState = createSession(sessionId, players, 0, winningScore)
      setLocalGame(true)
      setActiveGameSessionId(sessionId)
      setActiveGame(gameState)
      setView('game')
      showToast('Playing against the crows locally — every move runs on this device.')
      return
    }
    setLocalGame(false)
    try {
      const started = await startGameSession(activeLobbyId, session.user.id, seats, timer, winningScore)
      setActiveGameSessionId(started.id)
      setActiveGame(started.game_state)
      setView('game')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to start the game.') }
  }

  const openSettings = () => {
    if (!session?.user) return showToast('Sign in to open the shop.')
    setView('settings')
  }

  const selectCrowLogo = async (logoId: string) => {
    if (!session?.user) return showToast('Sign in to pick a crow for your card.')
    try {
      const next = logoId === 'classic' ? null : logoId
      await setCrowLogo(session.user.id, next)
      setMyCrowLogo(next)
      showToast('Your crow card is updated.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to save that crow.') }
  }

  const buyCrowLogo = async (logoId: string) => {
    if (!session?.user) return showToast('Sign in to buy a crow face.')
    try {
      const tokens = await purchaseCrowLogo(logoId)
      await setCrowLogo(session.user.id, logoId)
      setWallet((current) => ({ tokens, purchasedCrowLogos: current?.purchasedCrowLogos.includes(logoId) ? current.purchasedCrowLogos : [...(current?.purchasedCrowLogos ?? []), logoId], purchasedCardAnimations: current?.purchasedCardAnimations ?? [], cardAnimation: current?.cardAnimation ?? null, purchasedPlacements: current?.purchasedPlacements ?? [], placement: current?.placement ?? null, purchasedCardFonts: current?.purchasedCardFonts ?? [], cardFont: current?.cardFont ?? null }))
      setMyCrowLogo(logoId)
      showToast('Crow face bought and equipped.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to buy that crow face.') }
  }

  const buyCardAnimation = async (animationId: string) => {
    if (!session?.user) return showToast('Sign in to buy a frame animation.')
    try {
      const tokens = await purchaseCardAnimation(animationId)
      await setCardAnimation(animationId)
      setWallet((current) => ({ tokens, purchasedCrowLogos: current?.purchasedCrowLogos ?? [], purchasedCardAnimations: current?.purchasedCardAnimations.includes(animationId) ? current.purchasedCardAnimations : [...(current?.purchasedCardAnimations ?? []), animationId], cardAnimation: animationId, purchasedPlacements: current?.purchasedPlacements ?? [], placement: current?.placement ?? null, purchasedCardFonts: current?.purchasedCardFonts ?? [], cardFont: current?.cardFont ?? null }))
      showToast('Frame animation bought and equipped.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to buy that frame animation.') }
  }

  const selectCardAnimation = async (animationId: string | null) => {
    if (!session?.user) return showToast('Sign in to pick a frame animation.')
    try {
      await setCardAnimation(animationId)
      setWallet((current) => current ? { ...current, cardAnimation: animationId } : null)
      showToast(animationId ? 'Frame animation equipped.' : 'Plain cards restored.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to save that frame animation.') }
  }

  const buyPlacement = async (placementId: string) => {
    if (!session?.user) return showToast('Sign in to buy a crow placement.')
    try {
      const tokens = await purchasePlacement(placementId)
      await setPlacement(placementId)
      setWallet((current) => current ? { ...current, tokens, purchasedPlacements: current.purchasedPlacements.includes(placementId) ? current.purchasedPlacements : [...current.purchasedPlacements, placementId], placement: placementId } : null)
      showToast('Crow placement bought and equipped.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to buy that crow placement.') }
  }

  const selectPlacement = async (placementId: string | null) => {
    if (!session?.user) return showToast('Sign in to pick a crow placement.')
    try {
      await setPlacement(placementId)
      setWallet((current) => current ? { ...current, placement: placementId } : null)
      showToast(placementId ? 'Crow placement equipped.' : 'Plain crow card restored.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to save that crow placement.') }
  }

  const buyCardFont = async (fontId: string) => {
    if (!session?.user) return showToast('Sign in to buy a typeface.')
    try {
      const tokens = await purchaseCardFont(fontId)
      await setCardFont(fontId)
      setWallet((current) => current ? { ...current, tokens, purchasedCardFonts: current.purchasedCardFonts.includes(fontId) ? current.purchasedCardFonts : [...current.purchasedCardFonts, fontId], cardFont: fontId } : null)
      showToast('Typeface bought and equipped.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to buy that typeface.') }
  }

  const selectCardFont = async (fontId: string | null) => {
    if (!session?.user) return showToast('Sign in to pick a typeface.')
    try {
      await setCardFont(fontId)
      setWallet((current) => current ? { ...current, cardFont: fontId } : null)
      showToast(fontId ? 'Typeface equipped.' : 'Plain typeface restored.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to save that typeface.') }
  }

  const handleBid = async (amount: number | null) => {
    if (!activeGameSessionId || !session?.user || !activeGame) return
    const userId = session.user.id
    if (localGame) {
      try { setActiveGame(recordBid(structuredClone(activeGame), userId, amount)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to submit bid.') }
      return
    }
    try { setActiveGame(await submitBid(activeGameSessionId, activeGame, userId, amount)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to submit bid.') }
  }

  const handleTrump = async (color: CardColor) => {
    if (!activeGameSessionId || !session?.user || !activeGame) return
    const userId = session.user.id
    if (localGame) {
      try { setActiveGame(chooseTrump(structuredClone(activeGame), userId, color)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to choose trump.') }
      return
    }
    try { setActiveGame(await submitTrump(activeGameSessionId, activeGame, userId, color)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to choose trump.') }
  }

  const handleDiscard = async (cardIds: string[]) => {
    if (!activeGameSessionId || !session?.user || !activeGame) return
    const userId = session.user.id
    if (localGame) {
      try { setActiveGame(discardKitty(structuredClone(activeGame), userId, cardIds)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to discard those cards.') }
      return
    }
    try { setActiveGame(await submitDiscard(activeGameSessionId, activeGame, userId, cardIds)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to discard those cards.') }
  }

  const handleCard = async (cardId: string) => {
    if (!activeGameSessionId || !session?.user || !activeGame) return
    const userId = session.user.id
    if (localGame) {
      try { setActiveGame(playCard(structuredClone(activeGame), userId, cardId)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to play that card.') }
      return
    }
    try { setActiveGame(await submitCard(activeGameSessionId, activeGame, userId, cardId)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to play that card.') }
  }

  const handleRematch = async () => {
    if (!activeLobbyId) return
    if (localGame && activeGame) {
      const rematchState = { ...resetSessionForRematch(activeGame), id: crypto.randomUUID() }
      setActiveGameSessionId(rematchState.id)
      setActiveGame(rematchState)
      return
    }
    if (!activeGameSessionId || !activeGame) return
    try { setActiveGame(await rematchSession(activeGameSessionId, activeLobbyId, activeGame)) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to start the rematch.') }
  }

  const handleCloseLobby = async () => {
    if (!activeLobbyId || !session?.user) return
    const hostId = session.user.id
    if (localGame && activeGame && activeGameSessionId) {
      await flushLocalGame({ sessionId: activeGameSessionId, lobbyId: activeLobbyId, hostId, state: activeGame })
    }
    try {
      await closeLobby(activeLobbyId, hostId)
      setLocalGame(false)
      setActiveGame(null)
      setActiveGameSessionId(null)
      setView('home')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to close the lobby.') }
  }

  const handleGameBack = async () => {
    suppressGameAutoJoinRef.current = true
    if (localGame && activeLobbyId && activeGame && activeGameSessionId && session?.user) {
      await flushLocalGame({ sessionId: activeGameSessionId, lobbyId: activeLobbyId, hostId: session.user.id, state: activeGame })
    }
    setLocalGame(false)
    setActiveGame(null)
    setActiveGameSessionId(null)
    setView('lobby')
  }

  const totalGamesWon = playerStats ? (playerStats.games_won ?? 0) + (playerStats.ai_games_won ?? 0) : null
  const totalGamesCompleted = playerStats ? (playerStats.games_completed ?? 0) + (playerStats.ai_games_completed ?? 0) : null
  const totalHandsPlayed = playerStats ? (playerStats.hands_played ?? 0) + (playerStats.ai_hands_played ?? 0) : null

  if (authLoading) return <div className="auth-loading">Loading your table…</div>
  if (isSupabaseConfigured && !session) return <AuthScreen />

  if (view === 'game' && activeGame) return <GameScreen game={activeGame} sessionId={activeGameSessionId} currentUserId={session?.user.id} isHost={session?.user.id === activeLobbyHostId} crowLogos={crowLogosByPlayer} catalog={crowLogoCatalog} cardAnimation={wallet?.cardAnimation ?? null} placements={placementsByPlayer} cardFonts={fontsByPlayer} onRematch={handleRematch} onCloseLobby={handleCloseLobby} onBid={handleBid} onTrump={handleTrump} onDiscard={handleDiscard} onCard={handleCard} onBack={handleGameBack} localMode={localGame} />
  if (view === 'lobby') return <Lobby code={lobbyCode} name={lobbyName || 'Crow Table'} onRename={async (nextName) => { if (!activeLobbyId || !session?.user.id) return; try { setLobbyName((await updateLobbyName(activeLobbyId, session.user.id, nextName)).name) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to rename the table.') } }} seats={displaySeats} timer={timer} setTimer={setTimer} winningScore={winningScore} setWinningScore={setWinningScore} onSettingsChange={async (nextScore) => { if (!activeLobbyId || !session?.user.id) return; try { setWinningScore((await updateLobbySettings(activeLobbyId, session.user.id, { turnTimer: timer, winningScore: nextScore })).winningScore) } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update the winning score.') } }} makeAi={makeAi} setDifficulty={setDifficulty} hostId={activeLobbyHostId} currentUserId={session?.user.id} onBack={() => setView('home')} onStart={startGame} filled={filled} onSwapSeats={swapSeats} />
  if (view === 'settings') return <SettingsScreen currentLogo={myCrowLogo} catalog={crowLogoCatalog} tokens={wallet?.tokens ?? 0} purchasedLogos={wallet?.purchasedCrowLogos ?? []} currentAnimation={wallet?.cardAnimation ?? null} purchasedAnimations={wallet?.purchasedCardAnimations ?? []} currentPlacement={wallet?.placement ?? null} purchasedPlacements={wallet?.purchasedPlacements ?? []} currentFont={wallet?.cardFont ?? null} purchasedFonts={wallet?.purchasedCardFonts ?? []} onBack={() => setView('home')} onSelect={selectCrowLogo} onPurchase={buyCrowLogo} onSelectAnimation={selectCardAnimation} onPurchaseAnimation={buyCardAnimation} onSelectPlacement={selectPlacement} onPurchasePlacement={buyPlacement} onSelectFont={selectCardFont} onPurchaseFont={buyCardFont} displayName={displayName} onChangeDisplayName={handleChangeDisplayName} />

  return <main className="app-shell">
    {toast && <div className="toast">{toast}</div>}
    <header className="topbar"><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className={`status-dot ${isSupabaseConfigured ? 'online' : ''}`} /> {isSupabaseConfigured ? 'Connected' : 'Demo mode'} <span className="profile-email">{displayName || (session?.user ? 'Player' : name)}</span>{wallet && <span className="token-chip">◆ {wallet.tokens}</span>}<button className="settings-button" onClick={openSettings}>Shop</button><button className="sign-out-button" onClick={signOut}>Sign out</button></div></header>
    <section className="hero"><div className="hero-copy"><p className="eyebrow">A better seat at the table</p><h1>Bring your people.<br /><em>Deal the cards.</em></h1><p className="hero-text">A cozy place for family games, friendly rivalries, and one more hand before bed.</p><div className="hero-actions"><label className="join-field create-name-field"><span>Name your table</span><input value={lobbyName} onChange={(e) => setLobbyName(e.target.value)} placeholder="Or we’ll pick one for you" maxLength={40} /></label><button className="button primary" onClick={startLobby}>Create a private table <span>→</span></button><label className="join-field"><span>Have a code?</span><input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="CROW-XXXX" /><button onClick={() => joinCode ? enterLobby() : showToast('Enter a table code first.')}>Join</button></label></div></div><div className="hero-art"><div className="sun" /><div className="card card-back"><div className="card-pattern">C</div></div><div className="card card-front"><span className="card-corner">14<br /><i>red</i></span><span className="card-number">14</span><span className="card-corner bottom">14<br /><i>red</i></span></div><span className="sparkle one">✦</span><span className="sparkle two">✦</span></div></section>
    <section className="content-grid"><div className="panel welcome-panel"><div className="panel-heading"><div><p className="eyebrow">Your tables</p><h2>{myLobbies.length ? 'Back to the game' : 'Ready when you are'}</h2></div><span className="pill">{myLobbies.length ? 'Live' : 'New'}</span></div>{myLobbies.length > 0 ? <div className="lobby-list">{myLobbies.map((lobby) => <div className="lobby-row" key={lobby.id}><div className="lobby-row-mark">C</div><div className="lobby-row-info"><strong>{lobby.name}</strong><span>{lobby.status === 'in_progress' ? 'Game in progress' : 'Waiting for players'} · {lobby.join_code}{lobby.host_id === session?.user?.id ? ' · Host' : ''}</span></div><div className="lobby-row-actions"><button className="lobby-rejoin" onClick={() => rejoinLobby(lobby)}>{lobby.status === 'in_progress' ? 'Resume' : 'Rejoin'} <span>→</span></button><button className="lobby-leave" onClick={() => leaveLobbyFor(lobby)}>Leave</button></div></div>)}</div> : <div className="empty-table"><div className="mini-cards"><span>14</span><span>10</span><span>R</span></div><p>Create a private table and invite<br />your family with a simple code.</p><button className="text-button" onClick={startLobby}>Start a new table <span>→</span></button></div>}</div><div className="panel stats-panel"><div className="panel-heading"><div><p className="eyebrow">Your record</p><h2>At a glance</h2></div><button className="icon-button" onClick={() => setShowStats(true)} aria-label="Show all stats">↗</button></div><div className="stat-grid"><div><strong>{totalGamesWon ?? '—'}</strong><span>Games won</span></div><div><strong>{totalGamesWon !== null && totalGamesCompleted ? `${Math.round((totalGamesWon / totalGamesCompleted) * 100)}%` : '—'}</strong><span>Win rate</span></div><div><strong>{totalHandsPlayed ?? '—'}</strong><span>Hands played</span></div></div></div></section>
    <footer><span>Rieman family table · Built for the long haul</span><span>Rieman Rules · 4 players</span></footer>
    {showStats && <StatsModal stats={playerStats} onClose={() => setShowStats(false)} />}
  </main>
}

function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName.trim() } } })
    setBusy(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'sign-up') {
      const userId = result.data.user?.id
      if (userId) ensureProfile(userId, email, displayName).catch(() => undefined)
      setMessage('Check your email to confirm your account, then come back to sign in.')
    }
  }

  return <main className="auth-shell"><div className="auth-decoration"><span>10</span><span>14</span><span>C</span></div><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><p className="eyebrow">Your family table</p><h1>{mode === 'sign-in' ? 'Welcome back.' : 'Join the table.'}</h1><p className="auth-copy">{mode === 'sign-in' ? 'Sign in to find your tables and keep your stats.' : 'Create an account to play with family and keep your record.'}</p><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>{mode === 'sign-up' && <label>Display name<input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="What should the table call you?" autoComplete="nickname" /></label>}<label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label>{message && <p className="auth-message">{message}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Working…' : mode === 'sign-in' ? 'Sign in →' : 'Create account →'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>{mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></section></main>
}

function LegacyLobby({ code, seats, timer, setTimer, makeAi, setDifficulty, onBack, onStart, filled }: { code: string; seats: (LobbySeat & { color: string })[]; timer: number; setTimer: (value: number) => void; makeAi: (id: string) => void; setDifficulty: (id: string, difficulty: Difficulty) => void; onBack: () => void; onStart: () => void; filled: number }) {
  return <main className="app-shell lobby-shell"><header className="topbar"><button className="back-button" onClick={onBack}>← <span>Home</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className="status-dot" /> Private table</div></header><section className="lobby-header"><div><p className="eyebrow">Private table</p><h1>Gather your crows.</h1><p>Choose your seats, then start when everyone is ready.</p></div><div className="code-card"><span>JOIN CODE</span><strong>{code}</strong><button onClick={() => navigator.clipboard?.writeText(code)}>Copy code</button></div></section><section className="lobby-layout"><div className="panel seats-panel"><div className="panel-heading"><div><p className="eyebrow">The table</p><h2>{filled}/4 players ready</h2></div><span className="live-pill"><i /> Waiting</span></div><div className="seats-grid">{seats.map((seat) => <div className={`seat-card ${seat.status}`} key={seat.id}><div className="seat-top"><Avatar label={seat.name} color={seat.color} /><span className={`seat-badge team-${seat.team}`}>Team {seat.team}</span></div><strong>{seat.name}</strong>{seat.status === 'human' && seat.id === 'you' && <span className="seat-meta">That’s you · Host</span>}{seat.status === 'human' && seat.id !== 'you' && <span className="seat-meta">Connected</span>}{seat.status === 'open' && <><span className="seat-meta">Waiting for a player</span><button className="seat-action" onClick={() => makeAi(seat.id)}>Fill with AI +</button></>}{seat.status === 'ai' && <><span className="seat-meta">AI opponent</span><select value={seat.difficulty} onChange={(e) => setDifficulty(seat.id, e.target.value as Difficulty)}><option>Newbie</option><option>Average</option><option>Skilled</option></select></>}</div>)}</div><div className="team-note"><span>●</span><p>Teams are assigned by the host. Team A and Team B will alternate partner positions around the table.</p></div></div><aside className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">Table settings</p><h2>Rieman Rules</h2></div><span className="rules-icon">R</span></div><div className="setting"><span>Ruleset</span><strong>Rieman Rules <small>500 points</small></strong></div><div className="setting"><span>Turn timer</span><div className="stepper"><button onClick={() => setTimer(Math.max(10, timer - 5))}>−</button><strong>{timer}s</strong><button onClick={() => setTimer(Math.min(120, timer + 5))}>+</button></div></div><div className="rule-summary"><strong>Quick rules</strong><p>Crow is always trump · 110 points per hand · Dealer takes 65 if all pass.</p></div><button className="button primary full" disabled={seats.some((s) => s.status === 'open')} onClick={onStart}>Start the game <span>→</span></button><p className="small-help">Everyone can rejoin if they disconnect. The host can’t remove players once the game begins.</p></aside></section></main>
}

function Lobby({ code, name, onRename, seats, timer, setTimer, winningScore, setWinningScore, onSettingsChange, makeAi, setDifficulty, hostId, currentUserId, onBack, onStart, filled, onSwapSeats }: { code: string; name: string; onRename: (name: string) => void; seats: (LobbySeat & { color: string })[]; timer: number; setTimer: (value: number) => void; winningScore: number; setWinningScore: (value: number) => void; onSettingsChange: (value: number) => void; makeAi: (id: string) => void; setDifficulty: (id: string, difficulty: Difficulty) => void; hostId: string | null; currentUserId?: string; onBack: () => void; onStart: () => void; filled: number; onSwapSeats: (firstId: string, secondId: string) => void }) {
  const isHost = Boolean(hostId && currentUserId === hostId)
  const host = seats.find((seat) => seat.id === hostId)
  const canStart = isHost && !seats.some((seat) => seat.status === 'open')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const [moveFrom, setMoveFrom] = useState<string | null>(null)
  const [showRules, setShowRules] = useState(false)
  const handleSwapClick = (seatId: string) => {
    if (!moveFrom) { setMoveFrom(seatId); return }
    if (moveFrom === seatId) { setMoveFrom(null); return }
    onSwapSeats(moveFrom, seatId)
    setMoveFrom(null)
  }
  return <main className="app-shell lobby-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}>← <span>Home</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className="status-dot" /> Private table</div></header>
    <section className="lobby-header"><div><p className="eyebrow">Private table</p><h1 className="lobby-title">{name}</h1>{isHost && (editingName ? <form className="rename-form" onSubmit={(e) => { e.preventDefault(); onRename(nameDraft); setEditingName(false) }}><input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} autoFocus /><button className="text-button" type="submit">Save</button><button className="text-button" type="button" onClick={() => { setEditingName(false); setNameDraft(name) }}>Cancel</button></form> : <button className="text-button rename-button" onClick={() => { setNameDraft(name); setEditingName(true) }}>Rename table</button>)}<p className="lobby-sub">Gather your crows. Choose your seats, then start when everyone is ready.</p></div><div className="code-card"><span>JOIN CODE</span><strong>{code}</strong><button onClick={() => navigator.clipboard?.writeText(code)}>Copy code</button></div></section>
    <section className="lobby-layout"><div className="panel seats-panel"><div className="panel-heading"><div><p className="eyebrow">The table</p><h2>{filled}/4 players ready</h2><p className="host-line">Leader: <strong>{host?.name ?? 'Table host'}</strong>{isHost ? ' · You' : ''}</p></div><span className="live-pill"><i /> Waiting</span></div><div className="seats-grid">{seats.map((seat) => <div className={`seat-card ${seat.status} ${moveFrom === seat.id ? 'swapping' : ''}`} key={seat.id}><div className="seat-top"><Avatar label={seat.name} color={seat.color} /><span className={`seat-badge team-${seat.team}`}>Team {seat.team}</span></div><strong>{seat.name}</strong>{seat.id === hostId && <span className="host-badge">Table leader</span>}{seat.status === 'human' && seat.id !== hostId && <span className="seat-meta">Connected</span>}{seat.status === 'open' && <><span className="seat-meta">Waiting for a player</span>{isHost && <button className="seat-action" onClick={() => makeAi(seat.id)}>Fill with AI +</button>}</>}{seat.status === 'ai' && <><span className="seat-meta">AI opponent</span>{isHost ? <select value={seat.difficulty} onChange={(e) => setDifficulty(seat.id, e.target.value as Difficulty)}><option>Newbie</option><option>Average</option><option>Skilled</option></select> : <span className="seat-meta">Set by the leader</span>}</>}{isHost && <button className="seat-move" onClick={() => handleSwapClick(seat.id)}>{moveFrom === seat.id ? 'Cancel' : moveFrom ? `Swap with ${seats.find((candidate) => candidate.id === moveFrom)?.name ?? 'player'}` : 'Move'}</button>}</div>)}</div><div className="team-note"><span>●</span><p>{isHost ? (moveFrom ? 'Now choose a seat to swap with, or press Cancel on the picked-up seat.' : 'You are the table leader. Move swaps two players, and each takes their new seat’s team.') : `The table leader is ${host?.name ?? 'the host'}. They arrange seats, teams, and AI before starting.`}</p></div></div><aside className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">Table settings</p><h2>Rieman Rules</h2></div><span className="rules-icon">R</span></div><div className="setting ruleset-setting"><span>Ruleset</span><div className="ruleset-value"><strong>Rieman Rules <small>500 points</small></strong><button className="rules-info-button" onClick={() => setShowRules(true)} aria-label="How to play Rieman Rules">?</button></div></div><div className="setting"><span>Winning score</span><div className="stepper"><button disabled={!isHost} onClick={() => { const next = Math.max(250, winningScore - 50); setWinningScore(next); onSettingsChange(next) }}>−</button><strong>{winningScore}</strong><button disabled={!isHost} onClick={() => { const next = Math.min(1000, winningScore + 50); setWinningScore(next); onSettingsChange(next) }}>+</button></div></div><div className="setting"><span>Turn timer</span><div className="stepper"><button disabled={!isHost} onClick={() => setTimer(Math.max(10, timer - 5))}>−</button><strong>{timer}s</strong><button disabled={!isHost} onClick={() => setTimer(Math.min(120, timer + 5))}>+</button></div></div><div className="rule-summary"><strong>Quick rules</strong><p>Crow is always trump · 110 points per hand · Dealer takes 65 if all pass.</p></div><button className="button primary full" disabled={!canStart} onClick={onStart}>{isHost ? 'Start the game' : 'Waiting for the leader'} <span>→</span></button><p className="small-help">Everyone can rejoin if they disconnect. Only the table leader can change seats or start the game.</p></aside></section>
    {showRules && <RulesModal name="Rieman Rules" onClose={() => setShowRules(false)} />}
  </main>
}

function RulesModal({ name, onClose }: { name: string; onClose: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card rules-modal-card" onClick={(event) => event.stopPropagation()}>
    <div className="rules-modal-heading"><span className="rules-icon">R</span><div><p className="eyebrow">How to play</p><h3>{name}</h3></div><button className="rules-modal-close" onClick={onClose} aria-label="Close rules">×</button></div>
    <div className="rules-body">
      <h4>The deck</h4>
      <p>57 cards in four colors — black, red, yellow, green — numbered 1 through 14, plus one <strong>Crow</strong>. The Crow is always trump.</p>
      <h4>Teams &amp; the table</h4>
      <p>Four players split into two teams of two. Partners sit across from each other and count points together.</p>
      <h4>The deal</h4>
      <p>Each player receives 13 cards. The last 5 go face-down to a kitty in the middle of the table.</p>
      <h4>Bidding</h4>
      <p>The player left of the dealer starts the bidding. Bids run from 65 to 110 in steps of 5 — raise the bid or pass. The highest bidder wins the kitty; if everyone passes, the dealer is forced to take the bid at 65.</p>
      <h4>Kitty &amp; trump</h4>
      <p>The winning bidder picks up the kitty, then discards any five cards back down. Point cards — the Crow, 5s, 10s, and 14s — may never be discarded. Then they name one of the four colors as trump for the hand.</p>
      <h4>Playing a hand</h4>
      <p>The player left of the dealer leads any card, and everyone must follow that color if they can. The highest card of the led color wins the trick; trump beats plain colors, and the Crow beats everything. The winner of each trick leads the next until all 13 tricks are done.</p>
      <h4>Scoring</h4>
      <p>Captured cards earn points: the Crow is worth 10, 5s are worth 5, and 10s and 14s are worth 10 — 110 points in every hand. The bidding team must take at least what they bid, or that amount is subtracted from their score; the other team keeps every point they capture. First team to 500 wins the game.</p>
    </div>
    <div className="modal-actions"><button className="button primary" onClick={onClose}>Got it</button></div>
  </div></div>
}

function StatsModal({ stats, onClose }: { stats: PlayerStatistics | null; onClose: () => void }) {
  const colorLabel: Record<string, string> = { black: 'Black', red: 'Red', yellow: 'Yellow', green: 'Green' }
  const renderGrid = (source: { games_won: number; games_lost: number; games_unfinished: number; games_completed: number; hands_played: number; hands_bid: number; winning_bids: number; favorite_colors: Record<string, number> }) => {
    const winRate = source.games_completed ? Math.round((source.games_won / source.games_completed) * 100) : 0
    const bidRate = source.hands_bid ? Math.round((source.winning_bids / source.hands_bid) * 100) : 0
    const colors = Object.entries(source.favorite_colors ?? {}).sort((a, b) => b[1] - a[1])
    const maxColor = colors.length ? Math.max(...colors.map(([, count]) => count)) : 0
    return <><div className="stat-grid stats-grid">
      <div><strong>{source.games_won}</strong><span>Games won</span></div>
      <div><strong>{source.games_lost}</strong><span>Games lost</span></div>
      <div><strong>{winRate}%</strong><span>Win rate</span></div>
      <div><strong>{source.games_completed}</strong><span>Games completed</span></div>
      <div><strong>{source.games_unfinished}</strong><span>Games unfinished</span></div>
      <div><strong>{source.hands_played}</strong><span>Hands played</span></div>
      <div><strong>{source.hands_bid}</strong><span>Hands bid</span></div>
      <div><strong>{source.winning_bids}</strong><span>Winning bids</span></div>
      <div><strong>{bidRate}%</strong><span>Bid success</span></div>
    </div>
    {colors.length > 0 && <div className="favorites"><p className="eyebrow">Favorite trump</p>{colors.map(([color, count]) => <div className="favorite-row" key={color}><span>{colorLabel[color] ?? color}</span><div className="favorite-bar"><i className={`favorite-fill-${color}`} style={{ width: `${maxColor ? (count / maxColor) * 100 : 0}%` }} /></div><strong>{count}</strong></div>)}</div>}</>
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card rules-modal-card stats-modal-card" onClick={(event) => event.stopPropagation()}>
    <div className="rules-modal-heading"><span className="rules-icon">S</span><div><p className="eyebrow">Your record</p><h3>All your stats</h3></div><button className="rules-modal-close" onClick={onClose} aria-label="Close stats">×</button></div>
    {stats ? <><div className="stats-section">
      <p className="stats-section-label">Versus players</p>
        {renderGrid(stats)}
      </div>
      <div className="stats-section">
        <p className="stats-section-label">Versus AI</p>
        {renderGrid({ games_won: stats.ai_games_won, games_lost: stats.ai_games_lost, games_unfinished: stats.ai_games_unfinished, games_completed: stats.ai_games_completed, hands_played: stats.ai_hands_played, hands_bid: stats.ai_hands_bid, winning_bids: stats.ai_winning_bids, favorite_colors: stats.ai_favorite_colors })}
      </div>
    </> : <p className="stats-empty">Play your first game to start your record.</p>}
    <div className="modal-actions"><button className="button primary" onClick={onClose}>Done</button></div>
  </div></div>
}

function SettingsScreen({ currentLogo, catalog, tokens, purchasedLogos, currentAnimation, purchasedAnimations, currentPlacement, purchasedPlacements, currentFont, purchasedFonts, onBack, onSelect, onPurchase, onSelectAnimation, onPurchaseAnimation, onSelectPlacement, onPurchasePlacement, onSelectFont, onPurchaseFont, displayName, onChangeDisplayName }: { currentLogo: string | null; catalog: CrowLogoRecord[]; tokens: number; purchasedLogos: string[]; currentAnimation: string | null; purchasedAnimations: string[]; currentPlacement: string | null; purchasedPlacements: string[]; currentFont: string | null; purchasedFonts: string[]; onBack: () => void; onSelect: (id: string) => void; onPurchase: (id: string) => void; onSelectAnimation: (id: string | null) => void; onPurchaseAnimation: (id: string) => void; onSelectPlacement: (id: string | null) => void; onPurchasePlacement: (id: string) => void; onSelectFont: (id: string | null) => void; onPurchaseFont: (id: string) => void; displayName: string; onChangeDisplayName: (name: string) => void }) {
  const [confirm, setConfirm] = useState<{ title: string; description: string; priceLabel: string; canReplay: boolean; preview: ReactNode; onConfirm: () => void } | null>(null)
  const [nameDraft, setNameDraft] = useState(displayName)
  const [nameBusy, setNameBusy] = useState(false)
  const options = [...BUILTIN_CROW_LOGOS, ...catalog.map((record) => ({ id: record.id, name: record.name }))]
  const selected = currentLogo ?? 'classic'
  return <main className="app-shell settings-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}>← <span>Home</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div></header>
    <section className="settings-header"><p className="eyebrow">The shop</p><h1>Spend your tokens.</h1><p className="settings-sub">Win games to earn tokens — even against AI — then spend them on crow faces, card frame animations, and typefaces. Your picks follow you to every table.</p><div className="token-balance">◆ {tokens} tokens</div></section>
    <section className="panel settings-panel-lg">
      <div className="name-section">
        <div className="shop-section-heading"><p className="eyebrow">Your name</p><h3>What the table calls you.</h3><p className="settings-sub">Shown in the top bar and on your seat at every table.</p></div>
        <label className="join-field create-name-field"><span>Display name</span><input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} placeholder="Give yourself a name" /></label>
        <button className="button primary" disabled={nameBusy || nameDraft.trim() === displayName} onClick={() => { setNameBusy(true); onChangeDisplayName(nameDraft) }}>{nameBusy ? 'Saving…' : 'Save name'}</button>
      </div>
      <div className="crow-preview-row"><div className={`logo-preview-stack ${currentPlacement ? `crow-placement-${currentPlacement}` : ''}`} key={currentPlacement ?? 'none'}><div className={`playing-card crow-card logo-preview ${currentAnimation ? `card-anim-${currentAnimation}` : ''}`}><CrowLogo logoId={selected} catalog={catalog} /><small>Crow</small></div></div><p className="settings-sub">Everything equipped at once — your crow face, frame animation, and the entrance it makes when you play it.</p></div>
      <div className="crow-logo-grid">{options.map((option) => { const paid = isPaidCrowLogo(option.id); const owned = !paid || purchasedLogos.includes(option.id); return <button key={option.id} className={`crow-logo-option ${selected === option.id ? 'selected' : ''}`} onClick={() => (owned ? onSelect(option.id) : setConfirm({ title: option.name, description: 'A custom crow face for your rook card.', priceLabel: `${TOKENS_PER_CROW_FACE} tokens`, canReplay: false, preview: <div className="playing-card crow-card logo-preview"><CrowLogo logoId={option.id} catalog={catalog} /><small>Crow</small></div>, onConfirm: () => onPurchase(option.id) }))}><span className="crow-card-thumb"><CrowLogo logoId={option.id} catalog={catalog} /></span><span className="crow-logo-name">{option.name}</span><span className={`crow-logo-price ${owned ? 'owned' : 'unowned'}`}>{owned ? (selected === option.id ? 'Equipped' : 'Owned') : `${TOKENS_PER_CROW_FACE} tokens`}</span></button> })}</div>
      <div className="shop-section">
        <div className="shop-section-heading"><p className="eyebrow">Frame animations</p><h3>Make your rook move.</h3><p className="settings-sub">Each frame animation costs {COINS_PER_CARD_ANIMATION} tokens and animates your rook card in your hand.</p></div>
        <div className="anim-grid">
          <button key="none" className={`${currentAnimation === null ? 'selected' : ''}`} onClick={() => onSelectAnimation(null)}><div className="playing-card anim-preview"><strong>7</strong><small>red</small></div><span className="crow-logo-name">None</span><span className="crow-logo-price owned">Free</span></button>
          {CARD_ANIMATIONS.map((animation) => { const owned = purchasedAnimations.includes(animation.id); const equipped = currentAnimation === animation.id; return <button key={animation.id} className={`${equipped ? 'selected' : ''}`} onClick={() => (owned ? onSelectAnimation(animation.id) : setConfirm({ title: animation.name, description: animation.description, priceLabel: `${COINS_PER_CARD_ANIMATION} tokens`, canReplay: true, preview: <div className={`playing-card color-red card-anim-${animation.id} anim-preview`}><strong>7</strong><small>red</small></div>, onConfirm: () => onPurchaseAnimation(animation.id) }))} title={animation.description}><div className={`playing-card color-red card-anim-${animation.id} anim-preview`}><strong>7</strong><small>red</small></div><span className="crow-logo-name">{animation.name}</span><span className={`crow-logo-price ${owned ? 'owned' : 'unowned'}`}>{owned ? (equipped ? 'Equipped' : 'Owned') : `${COINS_PER_CARD_ANIMATION} tokens`}</span></button> })}
        </div>
      </div>
      <div className="shop-section">
        <div className="shop-section-heading"><p className="eyebrow">Crow placement</p><h3>Make an entrance.</h3><p className="settings-sub">When your crow card hits the table, it lands with its own signature effect. Tap an option to see it play — each costs {COINS_PER_PLACEMENT} tokens and you’ll confirm before it’s yours.</p></div>
        <div className="anim-grid">
          <button key="none" className={`${currentPlacement === null ? 'selected' : ''}`} onClick={() => onSelectPlacement(null)}><div className="playing-card crow-card anim-preview"><CrowLogo logoId="classic" catalog={catalog} /><small>Crow</small></div><span className="crow-logo-name">None</span><span className="crow-logo-price owned">Free</span></button>
          {PLACEMENTS.map((placement) => { const owned = purchasedPlacements.includes(placement.id); const equipped = currentPlacement === placement.id; return <button key={placement.id} className={`placement-option ${equipped ? 'selected' : ''}`} onClick={() => (owned ? onSelectPlacement(placement.id) : setConfirm({ title: placement.name, description: placement.description, priceLabel: `${COINS_PER_PLACEMENT} tokens`, canReplay: true, preview: <div className={`playing-card crow-card crow-placement-${placement.id} anim-preview`}><CrowLogo logoId="classic" catalog={catalog} /><small>Crow</small></div>, onConfirm: () => onPurchasePlacement(placement.id) }))} title={placement.description}><div className={`playing-card crow-card crow-placement-${placement.id} anim-preview`}><CrowLogo logoId="classic" catalog={catalog} /><small>Crow</small></div><span className="crow-logo-name">{placement.name}</span><span className={`crow-logo-price ${owned ? 'owned' : 'unowned'}`}>{owned ? (equipped ? 'Equipped' : 'Owned') : `${COINS_PER_PLACEMENT} tokens`}</span></button> })}
        </div>
      </div>
      <div className="shop-section">
        <div className="shop-section-heading"><p className="eyebrow">Card fonts</p><h3>Set the tone.</h3><p className="settings-sub">A typeface applies to every numbered card you play, in your hand and on the table. Each costs {COINS_PER_CARD_FONT} tokens.</p></div>
        <div className="anim-grid">
          <button key="none" className={`${currentFont === null ? 'selected' : ''}`} onClick={() => onSelectFont(null)}><div className="playing-card color-red anim-preview"><strong>14</strong><small>red</small></div><span className="crow-logo-name">None</span><span className="crow-logo-price owned">Free</span></button>
          {CARD_FONTS.map((font) => { const owned = purchasedFonts.includes(font.id); const equipped = currentFont === font.id; return <button key={font.id} className={`${equipped ? 'selected' : ''}`} onClick={() => (owned ? onSelectFont(font.id) : setConfirm({ title: font.name, description: font.description, priceLabel: `${COINS_PER_CARD_FONT} tokens`, canReplay: false, preview: <div className={`playing-card color-red card-font-${font.id} anim-preview`}><strong>14</strong><small>red</small></div>, onConfirm: () => onPurchaseFont(font.id) }))} title={font.description}><div className={`playing-card color-red card-font-${font.id} anim-preview`}><strong>14</strong><small>red</small></div><span className="crow-logo-name">{font.name}</span><span className={`crow-logo-price ${owned ? 'owned' : 'unowned'}`}>{owned ? (equipped ? 'Equipped' : 'Owned') : `${COINS_PER_CARD_FONT} tokens`}</span></button> })}
        </div>
      </div>
    </section>
    {confirm && <PurchaseModal key={confirm.title} confirm={confirm} onClose={() => setConfirm(null)} />}
  </main>
}

function PurchaseModal({ confirm, onClose }: { confirm: { title: string; description: string; priceLabel: string; canReplay: boolean; preview: ReactNode; onConfirm: () => void }; onClose: () => void }) {
  const [replayTick, setReplayTick] = useState(0)
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card" onClick={(event) => event.stopPropagation()}><div className="modal-preview" key={replayTick}>{confirm.preview}</div><h3>Buy {confirm.title}?</h3><p>{confirm.description}</p><p className="modal-price">Costs {confirm.priceLabel}</p>{confirm.canReplay && <button className="replay-button" onClick={() => setReplayTick((tick) => tick + 1)}>Play again</button>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => { confirm.onConfirm(); onClose() }}>Buy for {confirm.priceLabel}</button></div></div></div>
}

function GameScreen({ game, sessionId, currentUserId, isHost, crowLogos, catalog, cardAnimation, placements, cardFonts, onRematch, onCloseLobby, onBid, onTrump, onDiscard, onCard, onBack, localMode = false }: { game: SessionState; sessionId: string | null; currentUserId?: string; isHost: boolean; crowLogos: Record<string, string | null>; catalog: CrowLogoRecord[]; cardAnimation: string | null; placements: Record<string, string | null>; cardFonts: Record<string, string | null>; onRematch: () => void; onCloseLobby: () => void; onBid: (amount: number | null) => void; onTrump: (color: CardColor) => void; onDiscard: (cardIds: string[]) => void; onCard: (cardId: string) => void; onBack: () => void; localMode?: boolean }) {
  const [selectedDiscard, setSelectedDiscard] = useState<string[]>([])
  const showShuffle = false
  const currentPlayer = game.players[game.hand?.currentPlayerIndex ?? 0]
  const me = game.players.find((player) => player.id === currentUserId)
  const bidder = game.players.find((player) => player.id === game.hand?.bidderId)
  const isMyTurn = currentPlayer?.id === currentUserId
  const isBidder = bidder?.id === currentUserId
  const dealer = game.players[game.hand?.dealerIndex ?? 0]
  const bidOptions = Array.from({ length: 10 }, (_, index) => 65 + index * 5).filter((bid) => bid > (game.hand?.currentBid ?? 0))
  const availableTrumpColors = (['black', 'red', 'yellow', 'green'] as CardColor[]).filter((color) => bidder?.hand.some((card) => card.kind === 'number' && card.color === color))
  const activeTrick = game.hand?.tricks[game.hand.tricks.length - 1]?.cards.length === 4 ? undefined : game.hand?.tricks[game.hand.tricks.length - 1]
  const lastTrick = [...(game.hand?.tricks ?? [])].reverse().find((trick) => trick.cards.length === 4)
  const tableTrick = game.hand?.tricks[game.hand.tricks.length - 1]
  const latestBids = new Map((game.hand?.bids ?? []).map((bid, index, bids) => [bid.playerId, { ...bid, index }]))
  const tableStatus = (() => {
    if (game.hand?.phase === 'bidding' || game.hand?.phase === 'complete') return null
    const bidTeam = bidder?.team
    const bid = game.hand?.currentBid
    if (!bidTeam || !bid) return null
    if (capturedPointsForTeam(game, bidTeam) >= bid) return 'made'
    const otherTeam = bidTeam === 'A' ? 'B' : 'A'
    if (110 - capturedPointsForTeam(game, otherTeam) < bid) return 'set'
    return null
  })()
  const visualPosition = (playerIndex: number) => {
    const myIndex = Math.max(0, game.players.findIndex((player) => player.id === currentUserId))
    return (playerIndex - myIndex + game.players.length) % game.players.length
  }
  const leadColor = leadColorForTrick(activeTrick, game.hand?.trumpColor)
  const legalCardIds = new Set((me?.hand ?? []).filter((card) => canPlayCard(me?.hand ?? [], card, leadColor, game.hand?.trumpColor)).map((card) => card.id))
  const toggleDiscard = (card: Card) => { if (card.kind === 'crow' || (card.kind === 'number' && [5, 10, 14].includes(card.value))) return; setSelectedDiscard((selected) => selected.includes(card.id) ? selected.filter((id) => id !== card.id) : selected.length < 5 ? [...selected, card.id] : selected) }
  const gameOver = game.hand?.phase === 'complete' && game.status === 'completed'
  const phaseTitle = gameOver ? 'The table is done.' : game.hand?.phase === 'bidding' ? 'Make your bid.' : game.hand?.phase === 'trump' ? 'Choose trump.' : game.hand?.phase === 'kitty' ? 'Discard the kitty.' : 'The hand is live.'
  return <main className="app-shell game-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}>← <span>Lobby</span></button><div className="brand"><span className="brand-mark">C</span><span>The Crow Game</span></div><div className="connection"><span className={`status-dot ${localMode ? '' : 'online'}`} /> {localMode ? 'Local game' : 'Live table'}</div></header>
    <section className="game-header"><div><p className="eyebrow">Rieman Rules · Hand {game.handNumber + 1}</p><h1>{phaseTitle}</h1></div><div className="scoreboard"><div><span>{teamLabel('A', game, currentUserId)}</span><strong>{game.scores.A}</strong></div><div><span>{teamLabel('B', game, currentUserId)}</span><strong>{game.scores.B}</strong></div></div></section>
    {gameOver && <GameResult game={game} currentUserId={currentUserId} isHost={isHost} onRematch={onRematch} onCloseLobby={onCloseLobby} />}
    {!gameOver && game.hand?.phase === 'complete' && <div className={`result-banner ${game.hand.bidMade ? '' : 'failed-bid'}`}><strong>{game.hand.bidMade ? `${teamLabel(game.hand.bidderTeam ?? 'A', game, currentUserId)} made the bid` : `${teamLabel(game.hand.bidderTeam ?? 'A', game, currentUserId)} failed the bid`}</strong><span>Bid {game.hand.currentBid} · Captured {game.hand.teamPoints?.[game.hand.bidderTeam ?? 'A'] ?? 0} · Score {game.hand.scoreDelta?.[game.hand.bidderTeam ?? 'A'] ?? 0}</span></div>}
    {!gameOver && <section className={`game-board ${tableStatus ? `table-${tableStatus}` : ''}`}><div className={`table-center ${game.hand?.trumpColor ? `table-trump-${game.hand.trumpColor}` : ''}`}><strong>{game.hand?.phase === 'bidding' ? game.hand.currentBid ?? 'No bid' : teamLabel(bidder?.team ?? 'A', game, currentUserId)}</strong>{game.hand?.phase !== 'bidding' && <small>{game.hand?.currentBid ?? '—'} points</small>}{game.hand?.bidderId && <div className="table-hand-points"><strong>{teamLabel('A', game, currentUserId)} {capturedPointsForTeam(game, 'A')}</strong><strong>{teamLabel('B', game, currentUserId)} {capturedPointsForTeam(game, 'B')}</strong></div>}</div>{showShuffle && <ShuffleAnimation />}<TableCards trick={tableTrick} players={game.players} visualPosition={visualPosition} biddingStatus={game.hand?.phase === 'bidding' ? `${currentPlayer?.name ?? 'Player'} is bidding` : undefined} crowLogos={crowLogos} catalog={catalog} placements={placements} cardFonts={cardFonts} />{game.players.map((player, index) => { const bid = latestBids.get(player.id); const position = visualPosition(index); return <div className={`player-position player-${position} ${player.id === currentPlayer?.id ? 'is-turn' : ''}`} key={player.id}><Avatar label={player.name} color={avatarColors[index]} />{player.id === dealer?.id && <span className="dealer-chip">Dealer</span>}<span>{player.name}{player.id === currentUserId ? ' · You' : ''}</span><small>{player.isAi ? 'AI' : ''}</small>{game.hand?.phase === 'bidding' && <span className={`table-bid-status ${player.id === currentPlayer?.id ? 'bidding-now' : ''}`}>{player.id === currentPlayer?.id && 'Bidding'}{player.id !== currentPlayer?.id && bid && (bid.passed ? 'Passed' : `Bid ${bid.amount}`)}{player.id !== currentPlayer?.id && !bid && 'Not bid'}</span>}</div> })}</section>}
    {!gameOver && game.hand?.phase === 'trump' && <section className="action-panel"><p className="eyebrow">Trump selection</p><h2>{isBidder ? 'Which color will be trump?' : `${bidder?.name ?? 'The winning bidder'} is choosing trump`}</h2>{isBidder ? <div className="color-actions">{availableTrumpColors.map((color) => <button className={`color-choice color-${color}`} key={color} onClick={() => onTrump(color)}>{color}</button>)}</div> : <p className="muted-note">The winning bidder chooses a color they still hold.</p>}</section>}
    {!gameOver && <section className="hand-panel"><div className="hand-cards">{sortHand(me?.hand ?? [], game.hand?.trumpColor).map((card) => <CardView key={card.id} card={card} selected={selectedDiscard.includes(card.id)} crowLogo={crowLogos[currentUserId ?? ''] ?? null} catalog={catalog} animation={cardAnimation} font={cardFonts[currentUserId ?? ''] ?? null} onClick={game.hand?.phase === 'kitty' && isBidder ? () => toggleDiscard(card) : game.hand?.phase === 'playing' && isMyTurn && legalCardIds.has(card.id) ? () => onCard(card.id) : undefined} />)}</div>{game.hand?.phase === 'bidding' && <div className="bid-controls"><button className="pass-button" disabled={!isMyTurn} onClick={() => onBid(null)}>Pass</button><div className="bid-options">{bidOptions.map((bid) => <button key={bid} disabled={!isMyTurn} onClick={() => onBid(bid)}>{bid}</button>)}</div></div>}{game.hand?.phase === 'kitty' && isBidder && <button className="button primary discard-button" disabled={selectedDiscard.length !== 5} onClick={() => { onDiscard(selectedDiscard); setSelectedDiscard([]) }}>Discard selected cards →</button>}</section>}
    {!gameOver && (game.hand?.phase === 'playing' || game.hand?.phase === 'complete') && <TrickPanel trick={lastTrick} players={game.players} completed crowLogos={crowLogos} catalog={catalog} />}
    {!gameOver && game.hand?.phase === 'complete' && <section className="next-hand-panel"><div><p className="eyebrow">Hand complete</p><h2>Scores: {teamLabel('A', game, currentUserId)} {game.scores.A} · {teamLabel('B', game, currentUserId)} {game.scores.B}</h2></div><p className="muted-note">Dealing the next hand…</p></section>}
    <div className="game-note"><span className="rules-icon">R</span><p>{sessionId ? 'Game state is saved and synchronized with everyone at the table.' : 'Connecting this table to the active session…'}</p></div>
  </main>
}

function TrickPanel({ trick, players, completed, crowLogos, catalog }: { trick?: { cards: Array<{ playerId: string; card: Card }>; winnerId?: string }; players: SessionState['players']; completed: boolean; crowLogos: Record<string, string | null>; catalog: CrowLogoRecord[] }) {
  return <section className="trick-panel"><div><p className="eyebrow">{completed ? 'Last trick' : 'Current trick'}</p><h2>{trick?.cards.length ?? 0}/4 cards played</h2></div><div className="trick-cards">{trick?.cards.map(({ playerId, card }) => <div className="trick-card" key={`${playerId}-${card.id}`}><CardView card={card} crowLogo={crowLogos[playerId] ?? null} catalog={catalog} /><small>{players.find((player) => player.id === playerId)?.name ?? 'Player'}</small></div>)}</div>{trick?.winnerId && <p className="trick-winner">Trick won by {players.find((player) => player.id === trick.winnerId)?.name ?? 'player'}{completed ? ' · next lead' : ''}</p>}</section>
}

function GameResult({ game, currentUserId, isHost, onRematch, onCloseLobby }: { game: SessionState; currentUserId?: string; isHost: boolean; onRematch: () => void; onCloseLobby: () => void }) {
  const myTeam = game.players.find((player) => player.id === currentUserId)?.team
  const won = myTeam === game.hand?.gameWinner
  const confetti = createConfetti()
  return <section className={`game-result ${won ? 'game-won' : 'game-lost'}`}>{won && <div className="confetti" aria-hidden>{confetti.map((piece) => <i key={piece.id} style={{ left: piece.left, animationDelay: piece.delay, background: piece.color, transform: `rotate(${piece.rotation})` }} />)}</div>}<div className="result-icon">{won ? '★' : '○'}</div><p className="eyebrow">Game complete</p><h2>{teamLabel(game.hand?.gameWinner ?? 'A', game, currentUserId)} wins</h2><p>{won ? `You took the table and earned +${tokensForWinningScore(game.winningScore)} tokens.` : 'The cards had other plans this time.'}</p>{isHost ? <div className="result-actions"><button className="button primary" onClick={onRematch}>Rematch →</button><button className="secondary-button" onClick={onCloseLobby}>Close lobby</button></div> : <p className="muted-note">Waiting for the table leader to choose a rematch or close the lobby.</p>}</section>
}

function TableCards({ trick, players, visualPosition, completed = Boolean(trick?.cards.length === 4), biddingStatus, crowLogos, catalog, placements, cardFonts }: { trick?: { cards: Array<{ playerId: string; card: Card }>; winnerId?: string }; players: SessionState['players']; visualPosition: (index: number) => number; completed?: boolean; biddingStatus?: string; crowLogos: Record<string, string | null>; catalog: CrowLogoRecord[]; placements: Record<string, string | null>; cardFonts: Record<string, string | null> }) {
  if (!trick?.cards.length) return <div className="table-empty">{biddingStatus ?? 'Cards played this trick will appear here.'}</div>
  const winnerIndex = players.findIndex((player) => player.id === trick.cards.find((played) => played.playerId === trick.winnerId)?.playerId)
  const lastCard = trick?.cards[trick.cards.length - 1]?.card
  return <div className={`table-cards ${completed ? 'trick-capture' : ''} ${completed && lastCard?.kind === 'crow' ? 'trick-capture-rook' : ''}`}>{trick.cards.map(({ playerId, card }) => { const playerIndex = visualPosition(players.findIndex((player) => player.id === playerId)); return <div className={`table-card-play table-card-position-${playerIndex} capture-target-${visualPosition(winnerIndex)}`} key={`${playerId}-${card.id}`}><CardView card={card} crowLogo={crowLogos[playerId] ?? null} catalog={catalog} placement={placements[playerId] ?? null} font={cardFonts[playerId] ?? null} /></div> })}</div>
}

function ShuffleAnimation() { return null }


function BidHistory({ game, currentPlayerId }: { game: SessionState; currentPlayerId?: string }) {
  const bids = game.hand?.bids ?? []
  const passedPlayers = new Set(bids.filter((bid) => bid.passed).map((bid) => bid.playerId))
  return <section className="bid-history"><div className="history-heading"><div><p className="eyebrow">Bidding</p><h2>Current bid: {game.hand?.currentBid ?? '—'}</h2></div><span>{passedPlayers.size} passed · {game.players.length - passedPlayers.size} eligible</span></div><div className="bid-players">{game.players.map((player, index) => { const latest = [...bids].reverse().find((bid) => bid.playerId === player.id); return <div className={`bid-player ${player.id === currentPlayerId ? 'active' : ''}`} key={player.id}><Avatar label={player.name} color={avatarColors[index]} /><div><strong>{player.name}{player.id === currentPlayerId ? ' · Up now' : ''}</strong><small>{latest ? latest.passed ? 'Passed — out this hand' : `Bid ${latest.amount}` : 'Not bid yet'}</small></div></div> })}</div></section>
}

function CrowGlyph({ variant }: { variant: string }) {
  if (variant === 'fox') return (
    <svg className="crow-logo-svg" viewBox="0 0 48 48" aria-hidden focusable="false">
      <g fill="#fff">
        <path d="M15 20 L12.5 5.5 L21 12.5 Z" />
        <path d="M33 20 L35.5 5.5 L27 12.5 Z" />
        <path d="M24 12 C32.5 12 36.5 18.5 35.5 26.5 C34.5 35 29.5 41.5 24 41.5 C18.5 41.5 13.5 35 12.5 26.5 C11.5 18.5 15.5 12 24 12 Z" />
        <path d="M24 25.5 L20.5 34 L27.5 34 Z" opacity="0.85" />
      </g>
      <circle cx="20.5" cy="22.5" r="1.7" fill="#ec7765" />
      <circle cx="29.5" cy="22.5" r="1.7" fill="#ec7765" />
    </svg>
  )
  if (variant === 'owl') return (
    <svg className="crow-logo-svg" viewBox="0 0 48 48" aria-hidden focusable="false">
      <g fill="#fff">
        <path d="M16.5 14 L14.5 4 L20.5 10.5 Z" />
        <path d="M31.5 14 L33.5 4 L27.5 10.5 Z" />
        <path d="M24 11 C33 11 38 19 38 27.5 C38 36.5 31.5 42 24 42 C16.5 42 10 36.5 10 27.5 C10 19 15 11 24 11 Z" />
      </g>
      <circle cx="18.5" cy="27" r="2.7" fill="#ec7765" />
      <circle cx="29.5" cy="27" r="2.7" fill="#ec7765" />
    </svg>
  )
  if (variant === 'cat') return (
    <svg className="crow-logo-svg" viewBox="0 0 48 48" aria-hidden focusable="false">
      <g fill="#fff">
        <path d="M16.5 19 L13 3.5 L21.5 12 Z" />
        <path d="M31.5 19 L35 3.5 L26.5 12 Z" />
        <path d="M24 13 C32 13 36.5 19.5 35.5 27.5 C34.5 36 29.5 42 24 42 C18.5 42 13.5 36 12.5 27.5 C11.5 19.5 16 13 24 13 Z" />
      </g>
      <circle cx="20.5" cy="23.5" r="1.7" fill="#ec7765" />
      <circle cx="29.5" cy="23.5" r="1.7" fill="#ec7765" />
      <g stroke="#fff" stroke-width="1.1" stroke-linecap="round" fill="none">
        <path d="M13.5 30 L6.5 28.5" />
        <path d="M13.5 33 L6.5 33.5" />
        <path d="M34.5 30 L41.5 28.5" />
        <path d="M34.5 33 L41.5 33.5" />
      </g>
    </svg>
  )
  if (variant === 'panda') return (
    <svg className="crow-logo-svg" viewBox="0 0 48 48" aria-hidden focusable="false">
      <g fill="#fff">
        <path d="M24 16 C32 16 36.5 22.5 36 30.5 C35.5 38.5 30 42 24 42 C18 42 12.5 38.5 12 30.5 C11.5 22.5 16 16 24 16 Z" />
      </g>
      <circle cx="14" cy="16" r="4.6" fill="#333a40" />
      <circle cx="34" cy="16" r="4.6" fill="#333a40" />
      <ellipse cx="19" cy="27" rx="3.2" ry="4.2" fill="#333a40" />
      <ellipse cx="29" cy="27" rx="3.2" ry="4.2" fill="#333a40" />
      <circle cx="19.5" cy="26.5" r="1.1" fill="#fff" />
      <circle cx="29.5" cy="26.5" r="1.1" fill="#fff" />
      <ellipse cx="24" cy="35" rx="2.6" ry="2" fill="#333a40" />
    </svg>
  )
  return (
    <svg className="crow-logo-svg" viewBox="0 0 48 48" aria-hidden focusable="false">
      <g fill="#fff">
        <path d="M14 33 C14 25 22 21 32 23 C36 24 38 28 37 32 C36 37 30 40 24 40 C18 40 14 37 14 33 Z" />
        <circle cx="31" cy="18" r="7" />
        <path d="M37 15 L46 17.5 L37 20 Z" />
        <path d="M14 33 L5 30 L8 36 L4 37.5 L13 38 Z" opacity="0.92" />
      </g>
      <circle cx="32" cy="17" r="1.6" fill="#ec7765" />
      {variant === 'party' && <g><path d="M31 4.5 L39 13 L23 13 Z" fill="#f0b84f" /><circle cx="31" cy="4.5" r="2.6" fill="#fff" /></g>}
      {variant === 'cool' && <g><rect x="22.5" y="14.5" width="4.5" height="1.6" rx="0.8" fill="#283238" /><rect x="27" y="14" width="5" height="5" rx="1.6" fill="#283238" /><rect x="34" y="14" width="5" height="5" rx="1.6" fill="#283238" /><rect x="32" y="15.5" width="2" height="2" rx="0.6" fill="#283238" /></g>}
      {variant === 'crown' && <g><path d="M23 13.5 L26 7.5 L31 11 L35 7.5 L38 13.5 Z" fill="#f0b84f" /><circle cx="31" cy="10" r="1.3" fill="#ec7765" /><rect x="25" y="13.5" width="11" height="1.6" rx="0.8" fill="#e0b95e" /></g>}
      {variant === 'chef' && <g><ellipse cx="31" cy="7.5" rx="7.5" ry="5.4" fill="#f8e7c4" /><rect x="24.5" y="11" width="13" height="3.6" rx="1.4" fill="#f8e7c4" /><rect x="24.5" y="14" width="13" height="2.2" rx="0.9" fill="#e0b95e" /></g>}
    </svg>
  )
}

function CrowLogo({ logoId, catalog }: { logoId?: string | null; catalog: CrowLogoRecord[] }) {
  const id = logoId ?? 'classic'
  if (id === 'classic') return <strong>C</strong>
  if (BUILTIN_CROW_LOGOS.some((logo) => logo.id === id)) return <CrowGlyph variant={id} />
  const record = catalog.find((entry) => entry.id === id)
  if (record) return <img className="crow-card-image" src={crowLogoUrl(record)} alt="" draggable={false} />
  return <strong>C</strong>
}

function CardView({ card, selected, onClick, crowLogo, catalog, animation, placement, font }: { card: Card; selected?: boolean; onClick?: () => void; crowLogo?: string | null; catalog?: CrowLogoRecord[]; animation?: string | null; placement?: string | null; font?: string | null }) {
  const frame = card.kind === 'crow' && animation ? `card-anim-${animation}` : ''
  const place = card.kind === 'crow' && placement ? `crow-placement-${placement}` : ''
  const typeface = font ? `card-font-${font}` : ''
  if (card.kind === 'crow') return <div className={`playing-card crow-card ${selected ? 'selected' : ''} ${onClick ? 'playable' : ''} ${frame} ${place}`} onClick={onClick}><CrowLogo logoId={crowLogo} catalog={catalog ?? []} /><small>Crow</small></div>
  return <div className={`playing-card color-${card.color} ${selected ? 'selected' : ''} ${onClick ? 'playable' : ''} ${typeface}`} onClick={onClick}><strong>{card.value}</strong><small>{card.color}</small></div>
}

function sortHand(hand: Card[], trumpColor?: CardColor) {
  const colorOrder = ['black', 'red', 'yellow', 'green']
  const position = (card: Card) => {
    if (card.kind === 'crow') return trumpColor ? colorOrder.indexOf(trumpColor) - 0.5 : -1
    return colorOrder.indexOf(card.color)
  }
  return [...hand].sort((left, right) => {
    const leftPosition = position(left)
    const rightPosition = position(right)
    if (leftPosition !== rightPosition) return leftPosition - rightPosition
    if (left.kind === 'crow' || right.kind === 'crow') return 0
    return right.value - left.value
  })
}

export default App
