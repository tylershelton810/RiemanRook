import { createDeck, dealDeck, shuffleDeck } from './deck'
import { canPlayCard, isLegalBid, leadColorForTrick, pointsInCards } from './rules'
import { findTrickWinner } from './session'
import { riemanRules5Handed } from '../rules/riemanRules'
import type { Card, CardColor, HandState, PlayerSessionStats, PlayerState, SessionState, Team, Trick } from './types'
import type { Difficulty } from '../lib/types'

const RULES = riemanRules5Handed
const MIN_BID = RULES.bidding.minimum
const TOTAL_POINTS = 110

export function createSession5(id: string, players: PlayerState[], dealerIndex = 0, winningScore = 500): SessionState {
  if (players.length !== 5) throw new Error('A five-handed session requires five players.')
  return {
    id,
    status: 'active',
    players,
    scores: Object.fromEntries(players.map((player) => [player.team, 0])),
    handNumber: 0,
    winningScore,
    stats: Object.fromEntries(players.map((player) => [player.id, emptyPlayerStats5()])),
    rulesetId: 'rieman-rules-5',
    hand: startHand5(players, dealerIndex),
  }
}

function emptyPlayerStats5(): PlayerSessionStats { return { handsPlayed: 0, handsBid: 0, winningBids: 0, colors: {}, partners: {} } }

export function startHand5(players: PlayerState[], dealerIndex: number, random?: () => number): HandState {
  const { hands, kitty } = dealDeck(shuffleDeck(createDeck(), random), 5, RULES.deal.cardsPerPlayer, RULES.deal.kittySize)
  players.forEach((player, index) => { player.hand = hands[index] })
  const starter = previousPlayerIndex(dealerIndex, players.length)
  return { phase: 'bidding', dealerIndex, biddingPlayerIndex: starter, currentPlayerIndex: starter, currentBid: null, bids: [], kitty, tricks: [], completed: false }
}

export function recordBid5(session: SessionState, playerId: string, amount: number | null): SessionState {
  if (!session.hand || session.hand.phase !== 'bidding') throw new Error('Bidding is not active.')
  const playerIndex = session.players.findIndex((player) => player.id === playerId)
  if (playerIndex !== session.hand.currentPlayerIndex) throw new Error('It is not this player’s turn to bid.')
  if (session.hand.bids.some((bid) => bid.playerId === playerId && bid.passed)) throw new Error('You passed and are out of this hand’s bidding.')
  if (amount !== null && !isLegalBid(amount, session.hand.currentBid, RULES)) throw new Error('That bid is not valid.')
  session.hand.bids.push({ playerId, amount, passed: amount === null })
  if (amount !== null) { session.hand.currentBid = amount; session.hand.bidderId = playerId }
  const passedPlayers = new Set(session.hand.bids.filter((bid) => bid.passed).map((bid) => bid.playerId))
  const eligiblePlayers = session.players.filter((player) => !passedPlayers.has(player.id))
  const biddingHasWinner = session.hand.currentBid !== null && eligiblePlayers.length <= 1
  const everyonePassed = eligiblePlayers.length === 0 && session.hand.currentBid === null
  if (biddingHasWinner || everyonePassed) {
    if (everyonePassed) { session.hand.currentBid = MIN_BID; session.hand.bidderId = session.players[session.hand.dealerIndex].id }
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

export function discardKitty5(session: SessionState, playerId: string, cardIds: string[]): SessionState {
  if (!session.hand || session.hand.phase !== 'kitty' || session.hand.bidderId !== playerId) throw new Error('Only the winning bidder can discard the kitty.')
  if (cardIds.length !== RULES.deal.kittySize || new Set(cardIds).size !== RULES.deal.kittySize) throw new Error('Choose exactly two cards to discard.')
  const player = session.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error('Winning bidder not found.')
  const selected = player.hand.filter((card) => cardIds.includes(card.id))
  if (selected.length !== RULES.deal.kittySize) throw new Error('All discarded cards must be in your hand.')
  if (selected.some((card) => card.kind === 'crow' || (card.kind === 'number' && [5, 10, 14].includes(card.value)))) throw new Error('Point cards cannot be discarded.')
  player.hand = player.hand.filter((card) => !cardIds.includes(card.id))
  session.hand.kittyReveal = undefined
  session.hand.phase = 'calling'
  return session
}

export function callPartner5(session: SessionState, playerId: string, cardId: string): SessionState {
  if (!session.hand || session.hand.phase !== 'calling' || session.hand.bidderId !== playerId) throw new Error('Only the winning bidder can name a partner.')
  const player = session.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error('Winning bidder not found.')
  const card = createDeck().find((candidate) => candidate.id === cardId)
  if (!card) throw new Error('That card does not exist in the deck.')
  if (player.hand.some((candidate) => candidate.id === cardId)) throw new Error('You must name a card that is not in your hand.')
  const holder = session.players.find((candidate) => candidate.id !== playerId && candidate.hand.some((candidateCard) => candidateCard.id === cardId))
  if (!holder) throw new Error('That card is not in any other player’s hand.')
  session.hand.calledCard = card
  session.hand.partnershipRevealed = false
  if (card.kind === 'crow') {
    session.hand.alone = false
    session.hand.partnerId = holder.id
    session.hand.phase = 'trump'
  } else {
    session.hand.alone = false
    session.hand.partnerId = holder.id
    session.hand.trumpColor = card.color
    session.hand.phase = 'playing'
    session.hand.currentPlayerIndex = previousPlayerIndex(session.hand.dealerIndex, session.players.length)
  }
  return session
}

export function chooseTrump5(session: SessionState, playerId: string, color: CardColor): SessionState {
  if (!session.hand || session.hand.phase !== 'trump' || session.hand.bidderId !== playerId) throw new Error('Only the winning bidder can choose trump.')
  const player = session.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error('Winning bidder not found.')
  if (!player.hand.some((card) => card.kind === 'number' && card.color === color)) throw new Error('You can only choose a color you still hold.')
  session.hand.trumpColor = color
  session.hand.phase = 'playing'
  session.hand.currentPlayerIndex = previousPlayerIndex(session.hand.dealerIndex, session.players.length)
  return session
}

export function playCard5(session: SessionState, playerId: string, cardId: string): SessionState {
  if (!session.hand || session.hand.completed || session.hand.phase !== 'playing') throw new Error('Card play is not active.')
  const lastTrick = session.hand.tricks[session.hand.tricks.length - 1]
  if (lastTrick?.cards.length === 5 && lastTrick.visibleUntil && Date.now() < lastTrick.visibleUntil) throw new Error('The completed trick is still visible.')
  const playerIndex = session.players.findIndex((player) => player.id === playerId)
  if (playerIndex !== session.hand.currentPlayerIndex) throw new Error('It is not this player’s turn.')
  const player = session.players[playerIndex]
  const cardIndex = player.hand.findIndex((card) => card.id === cardId)
  if (cardIndex === -1) throw new Error('That card is not in the player’s hand.')
  const previousTrick = session.hand.tricks[session.hand.tricks.length - 1]
  const activeTrick = previousTrick && previousTrick.cards.length < 5 ? previousTrick : undefined
  const leadColor = leadColorForTrick(activeTrick, session.hand.trumpColor)
  const card = player.hand[cardIndex]
  if (!canPlayCard(player.hand, card, leadColor, session.hand.trumpColor)) throw new Error('You must follow the led color when able.')
  if (player.id === session.hand.partnerId && !session.hand.alone && !session.hand.partnershipRevealed) {
    const isTrump = card.kind === 'crow' || (card.kind === 'number' && card.color === session.hand.trumpColor)
    if (isTrump && card.id !== session.hand.calledCard?.id) throw new Error('The partner must play the named card the first time they play trump.')
  }
  player.hand.splice(cardIndex, 1)
  let trick = activeTrick
  if (!trick) { trick = { leaderId: playerId, cards: [] }; session.hand.tricks.push(trick) }
  trick.cards.push({ playerId, card })
  if (card.id === session.hand.calledCard?.id) {
    session.hand.partnershipRevealed = true
    if (session.hand.partnerId === undefined) session.hand.partnerId = playerId
  }
  if (trick.cards.length === 5) {
    trick.winnerId = findTrickWinner(trick, session.hand.trumpColor)
    trick.visibleUntil = Date.now() + (card.kind === 'crow' ? 1000 : 500)
  }
  if (trick.cards.length === 5 && session.players.every((candidate) => candidate.hand.length === 0)) {
    finalizeHand5(session)
  }
  session.hand.currentPlayerIndex = trick.cards.length === 5 ? session.players.findIndex((candidate) => candidate.id === trick.winnerId) : previousPlayerIndex(playerIndex, session.players.length)
  return session
}

function finalizeHand5(session: SessionState) {
  const hand = session.hand
  if (!hand) return
  hand.phase = 'complete'
  hand.completed = true
  const pairIds = hand.alone ? [hand.bidderId!] : hand.partnerId ? [hand.bidderId!, hand.partnerId] : [hand.bidderId!]
  const pairSet = new Set(pairIds)
  const pairCaptured = pointsInCards(hand.tricks.flatMap((trick) => trick.winnerId && pairSet.has(trick.winnerId) ? trick.cards.map(({ card }) => card) : []))
  const trioCaptured = TOTAL_POINTS - pairCaptured
  hand.pairPoints = pairCaptured
  hand.trioPoints = trioCaptured
  const bid = hand.currentBid ?? MIN_BID
  const madeBid = pairCaptured >= bid
  hand.bidMade = madeBid
  const bidderTeam = session.players.find((player) => player.id === hand.bidderId)?.team
  if (!bidderTeam) throw new Error('Winning bid team not found.')
  hand.bidderTeam = bidderTeam
  const defenderTeam = session.players.find((player) => !pairSet.has(player.id))?.team
  if (!defenderTeam) throw new Error('Defending team not found.')
  const scoreDelta: Record<string, number> = {}
  session.players.forEach((player) => {
    const isPair = pairSet.has(player.id)
    scoreDelta[player.team] = isPair ? (madeBid ? pairCaptured : -bid) : trioCaptured
    session.scores[player.team] += scoreDelta[player.team]
  })
  hand.scoreDelta = scoreDelta
  hand.winningTeam = madeBid ? bidderTeam : defenderTeam
  hand.partnershipRevealed = true
  updateHandStats5(session, pairIds, madeBid)
  const pairScore = session.scores[bidderTeam]
  const trioScore = session.scores[defenderTeam]
  const pairOver = pairScore >= session.winningScore
  const trioOver = trioScore >= session.winningScore
  if (pairOver || trioOver) {
    session.status = 'completed'
    const crossed = session.players.filter((player) => session.scores[player.team] >= session.winningScore)
    const bidderCrossed = crossed.some((player) => player.id === hand.bidderId)
    const championId = crossed.length === 1 ? crossed[0].id : bidderCrossed ? hand.bidderId : crossed.length > 1 ? [...crossed].sort((a, b) => session.scores[b.team] - session.scores[a.team] || session.players.findIndex((candidate) => candidate.id === a.id) - session.players.findIndex((candidate) => candidate.id === b.id))[0].id : undefined
    const champion = championId ? session.players.find((player) => player.id === championId) : undefined
    hand.gameWinner = champion?.team ?? (pairOver ? bidderTeam : defenderTeam)
    hand.winnerPlayerIds = champion ? [champion.id] : []
  }
}

function updateHandStats5(session: SessionState, pairIds: string[], madeBid: boolean) {
  const bidderId = session.hand?.bidderId
  session.players.forEach((player) => {
    const stat = session.stats[player.id] ?? emptyPlayerStats5()
    stat.handsPlayed += 1
    const bidByPlayer = session.hand?.bids.some((bid) => bid.playerId === player.id && bid.amount !== null)
    if (bidByPlayer) stat.handsBid += 1
    if (player.id === bidderId) {
      stat.winningBids += 1
      if (session.hand?.trumpColor) stat.colors[session.hand.trumpColor] = (stat.colors[session.hand.trumpColor] ?? 0) + 1
    }
    session.stats[player.id] = stat
  })
  if (!session.hand?.alone && pairIds.length === 2) {
    const [first, second] = pairIds
    session.stats[first].partners[second] = (session.stats[first].partners[second] ?? 0) + 1
    session.stats[second].partners[first] = (session.stats[second].partners[first] ?? 0) + 1
  }
}

export function startNextHand5(session: SessionState): SessionState {
  if (!session.hand || !session.hand.completed || session.status === 'completed') throw new Error('This session cannot deal another hand.')
  const dealerIndex = session.hand.biddingPlayerIndex
  session.handNumber += 1
  session.hand = startHand5(session.players, dealerIndex)
  return session
}

export function resetSessionForRematch5(session: SessionState): SessionState {
  return {
    ...session,
    status: 'active',
    scores: Object.fromEntries(session.players.map((player) => [player.team, 0])),
    handNumber: 0,
    stats: Object.fromEntries(session.players.map((player) => [player.id, emptyPlayerStats5()])),
  }
}

function previousPlayerIndex(index: number, playerCount: number) {
  return (index + playerCount - 1) % playerCount
}

function findNextEligiblePlayer(index: number, players: PlayerState[], passedPlayers: Set<string>) {
  let nextIndex = previousPlayerIndex(index, players.length)
  while (passedPlayers.has(players[nextIndex].id)) nextIndex = previousPlayerIndex(nextIndex, players.length)
  return nextIndex
}
