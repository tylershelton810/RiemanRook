import { createDeck, dealDeck, shuffleDeck } from './deck'
import { canPlayCard, cardBeats, isLegalBid, leadColorForTrick, pointsInCards } from './rules'
import type { Card, CardColor, HandState, PlayerSessionStats, PlayerState, SessionState, Team, Trick } from './types'

export function createSession(id: string, players: PlayerState[], dealerIndex = 0, winningScore = 500): SessionState {
  if (players.length !== 4) throw new Error('A Crow session requires four players.')
  return { id, status: 'active', players, scores: { A: 0, B: 0 }, handNumber: 0, winningScore, stats: Object.fromEntries(players.map((player) => [player.id, emptyPlayerStats()])), hand: startHand(players, dealerIndex) }
}

const AI_NAMES = ['Pip', 'Moss', 'Scout', 'Clover']

export function fillMissingPlayersWithAi(session: SessionState, humanPlayerIds: Set<string>): SessionState {
  const usedNames = new Set(session.players.filter((player) => player.isAi).map((player) => player.name))
  let changed = false
  const players = session.players.map((player) => {
    if (player.isAi || humanPlayerIds.has(player.id)) return player
    changed = true
    const name = AI_NAMES.find((candidate) => !usedNames.has(candidate)) ?? `Crow AI ${usedNames.size + 1}`
    usedNames.add(name)
    return { ...player, isAi: true, connected: true, name }
  })
  return changed ? { ...session, players } : session
}

function emptyPlayerStats(): PlayerSessionStats { return { handsPlayed: 0, handsBid: 0, winningBids: 0, colors: {}, partners: {} } }

export function startHand(players: PlayerState[], dealerIndex: number, random?: () => number): HandState {
  const { hands, kitty } = dealDeck(shuffleDeck(createDeck(), random))
  players.forEach((player, index) => { player.hand = hands[index] })
  const starter = previousPlayerIndex(dealerIndex, players.length)
  return { phase: 'bidding', dealerIndex, biddingPlayerIndex: starter, currentPlayerIndex: starter, currentBid: null, bids: [], kitty, tricks: [], completed: false }
}

export function recordBid(session: SessionState, playerId: string, amount: number | null): SessionState {
  if (!session.hand || session.hand.phase !== 'bidding') throw new Error('Bidding is not active.')
  const playerIndex = session.players.findIndex((player) => player.id === playerId)
  if (playerIndex !== session.hand.currentPlayerIndex) throw new Error('It is not this player’s turn to bid.')
  if (session.hand.bids.some((bid) => bid.playerId === playerId && bid.passed)) throw new Error('You passed and are out of this hand’s bidding.')
  if (amount !== null && !isLegalBid(amount, session.hand.currentBid)) throw new Error('That bid is not valid.')
  session.hand.bids.push({ playerId, amount, passed: amount === null })
  if (amount !== null) { session.hand.currentBid = amount; session.hand.bidderId = playerId }
  const passedPlayers = new Set(session.hand.bids.filter((bid) => bid.passed).map((bid) => bid.playerId))
  const eligiblePlayers = session.players.filter((player) => !passedPlayers.has(player.id))
  const biddingHasWinner = session.hand.currentBid !== null && eligiblePlayers.length <= 1
  const everyonePassed = eligiblePlayers.length === 0 && session.hand.currentBid === null
  if (biddingHasWinner || everyonePassed) {
    if (everyonePassed) { session.hand.currentBid = 65; session.hand.bidderId = session.players[session.hand.dealerIndex].id }
    const bidder = session.players.find((player) => player.id === session.hand?.bidderId)
    if (!bidder) throw new Error('Winning bidder not found.')
    bidder.hand.push(...session.hand.kitty)
    session.hand.kittyReveal = [...session.hand.kitty]
    session.hand.kitty = []
    session.hand.phase = 'kitty'
    session.hand.currentPlayerIndex = session.players.findIndex((player) => player.id === session.hand?.bidderId)
  } else {
    session.hand.currentPlayerIndex = findNextEligiblePlayer(playerIndex, session.players, passedPlayers)
  }
  return session
}

export function chooseTrump(session: SessionState, playerId: string, color: CardColor): SessionState {
  if (!session.hand || session.hand.phase !== 'trump' || session.hand.bidderId !== playerId) throw new Error('Only the winning bidder can choose trump.')
  const player = session.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error('Winning bidder not found.')
  if (!player.hand.some((card) => card.kind === 'number' && card.color === color)) throw new Error('You can only choose a color you still hold.')
  session.hand.trumpColor = color
  session.hand.phase = 'playing'
  session.hand.currentPlayerIndex = previousPlayerIndex(session.hand.dealerIndex, session.players.length)
  return session
}

export function discardKitty(session: SessionState, playerId: string, cardIds: string[]): SessionState {
  if (!session.hand || session.hand.phase !== 'kitty' || session.hand.bidderId !== playerId) throw new Error('Only the winning bidder can discard the kitty.')
  if (cardIds.length !== 5 || new Set(cardIds).size !== 5) throw new Error('Choose exactly five cards to discard.')
  const player = session.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error('Winning bidder not found.')
  const selected = player.hand.filter((card) => cardIds.includes(card.id))
  if (selected.length !== 5) throw new Error('All discarded cards must be in your hand.')
  if (selected.some((card) => card.kind === 'crow' || (card.kind === 'number' && [5, 10, 14].includes(card.value)))) throw new Error('Point cards cannot be discarded.')
  player.hand = player.hand.filter((card) => !cardIds.includes(card.id))
  session.hand.kittyReveal = undefined
  session.hand.phase = 'trump'
  return session
}

export function playCard(session: SessionState, playerId: string, cardId: string): SessionState {
  if (!session.hand || session.hand.completed || session.hand.phase !== 'playing') throw new Error('Card play is not active.')
  const lastTrick = session.hand.tricks[session.hand.tricks.length - 1]
  if (lastTrick?.cards.length === 4 && lastTrick.visibleUntil && Date.now() < lastTrick.visibleUntil) throw new Error('The completed trick is still visible.')
  const playerIndex = session.players.findIndex((player) => player.id === playerId)
  if (playerIndex !== session.hand.currentPlayerIndex) throw new Error('It is not this player’s turn.')
  const player = session.players[playerIndex]
  const cardIndex = player.hand.findIndex((card) => card.id === cardId)
  if (cardIndex === -1) throw new Error('That card is not in the player’s hand.')
  const previousTrick = session.hand.tricks[session.hand.tricks.length - 1]
  const activeTrick = previousTrick && previousTrick.cards.length < 4 ? previousTrick : undefined
  const leadColor = getLeadColor(activeTrick, session.hand.trumpColor)
  const card = player.hand[cardIndex]
  if (!canPlayCard(player.hand, card, leadColor, session.hand.trumpColor)) throw new Error('You must follow the led color when able.')
  player.hand.splice(cardIndex, 1)
  let trick = activeTrick
  if (!trick) { trick = { leaderId: playerId, cards: [] }; session.hand.tricks.push(trick) }
  trick.cards.push({ playerId, card })
  if (trick.cards.length === 4) {
    trick.winnerId = findTrickWinner(trick, session.hand.trumpColor)
    trick.visibleUntil = Date.now() + (card.kind === 'crow' ? 1000 : 500)
  }
  if (trick.cards.length === 4 && session.players.every((candidate) => candidate.hand.length === 0)) {
    session.hand.phase = 'complete'
    session.hand.completed = true
    const teamPoints: Record<Team, number> = { A: capturedPointsForTeam(session, 'A'), B: capturedPointsForTeam(session, 'B') }
    session.hand.teamPoints = teamPoints
    const bidderTeam = session.players.find((player) => player.id === session.hand?.bidderId)?.team
    if (!bidderTeam) throw new Error('Winning bid team not found.')
    const otherTeam: Team = bidderTeam === 'A' ? 'B' : 'A'
    const bid = session.hand.currentBid ?? 65
    const madeBid = teamPoints[bidderTeam] >= bid
    const scoreDelta: Record<Team, number> = bidderTeam === 'A'
      ? { A: madeBid ? teamPoints.A : -bid, B: teamPoints.B }
      : { A: teamPoints.A, B: madeBid ? teamPoints.B : -bid }
    session.scores.A += scoreDelta.A
    session.scores.B += scoreDelta.B
    session.hand.winningTeam = madeBid ? bidderTeam : otherTeam
    session.hand.bidderTeam = bidderTeam
    session.hand.bidMade = madeBid
    session.hand.scoreDelta = scoreDelta
    updateHandStats(session, bidderTeam, madeBid)
    const aOver = session.scores.A >= session.winningScore
    const bOver = session.scores.B >= session.winningScore
    if (aOver || bOver) {
      session.status = 'completed'
      session.hand.gameWinner = aOver && bOver ? bidderTeam : aOver ? 'A' : 'B'
    }
  }
  session.hand.currentPlayerIndex = trick.cards.length === 4 ? session.players.findIndex((candidate) => candidate.id === trick.winnerId) : previousPlayerIndex(playerIndex, session.players.length)
  return session
}

function updateHandStats(session: SessionState, bidderTeam: Team, madeBid: boolean) {
  const bidderId = session.hand?.bidderId
  const bidder = session.players.find((player) => player.id === bidderId)
  session.players.forEach((player) => {
    const stat = session.stats[player.id] ?? emptyPlayerStats()
    stat.handsPlayed += 1
    const bidByPlayer = session.hand?.bids.some((bid) => bid.playerId === player.id && bid.amount !== null)
    if (bidByPlayer) stat.handsBid += 1
    if (player.id === bidderId) {
      stat.winningBids += 1
      if (session.hand?.trumpColor) stat.colors[session.hand.trumpColor] = (stat.colors[session.hand.trumpColor] ?? 0) + 1
    }
    const partner = session.players.find((candidate) => candidate.team === player.team && candidate.id !== player.id)
    if (partner) stat.partners[partner.id] = (stat.partners[partner.id] ?? 0) + 1
    session.stats[player.id] = stat
  })
}

export function startNextHand(session: SessionState): SessionState {
  if (!session.hand || !session.hand.completed || session.status === 'completed') throw new Error('This session cannot deal another hand.')
  const dealerIndex = session.hand.biddingPlayerIndex
  session.handNumber += 1
  session.hand = startHand(session.players, dealerIndex)
  return session
}

function previousPlayerIndex(index: number, playerCount: number) {
  return (index + playerCount - 1) % playerCount
}

function findNextEligiblePlayer(index: number, players: PlayerState[], passedPlayers: Set<string>) {
  let nextIndex = previousPlayerIndex(index, players.length)
  while (passedPlayers.has(players[nextIndex].id)) nextIndex = previousPlayerIndex(nextIndex, players.length)
  return nextIndex
}

function getLeadColor(trick?: Trick, trumpColor?: CardColor): CardColor | undefined {
  return leadColorForTrick(trick, trumpColor)
}

export function findTrickWinner(trick: Trick, trumpColor?: CardColor) {
  const leadColor = getLeadColor(trick)
  let winner = trick.cards[0]
  trick.cards.slice(1).forEach((played) => { if (cardBeats(played.card, winner.card, leadColor, trumpColor)) winner = played })
  return winner.playerId
}

export function capturedPointsForTeam(session: SessionState, team: Team) {
  const playerIds = new Set(session.players.filter((player) => player.team === team).map((player) => player.id))
  return pointsInCards(session.hand?.tricks.flatMap((trick) => trick.winnerId && playerIds.has(trick.winnerId) ? trick.cards.map(({ card }) => card) : []) ?? [])
}
