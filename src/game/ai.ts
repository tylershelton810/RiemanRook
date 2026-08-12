import { canPlayCard, cardBeats, leadColorForTrick } from './rules'
import { cardPoints } from './rules'
import type { Card, CardColor, HandKnowledge, HandState, PlayerState, Trick } from './types'

export function chooseAiBid(hand: Card[], currentBid: number | null, aiPlayer: PlayerState, players: PlayerState[], bidState: HandState) {
  const colorStrength = (color: CardColor) => hand.reduce((total, card) => {
    if (card.kind !== 'number' || card.color !== color) return total
    if (card.value === 14) return total + 8
    if (card.value === 13) return total + 5
    if (card.value === 12) return total + 3
    if (card.value === 11 || card.value === 10) return total + 2
    return total
  }, 0)
  const bestColorStrength = Math.max(...(['black', 'red', 'yellow', 'green'] as CardColor[]).map(colorStrength))
  const crowStrength = hand.some((card) => card.kind === 'crow') ? 12 : 0
  const strength = bestColorStrength + crowStrength
  const estimatedBid = Math.min(85, 65 + Math.floor(Math.max(0, strength - 14) / 5) * 5)
  const currentBidder = players.find((player) => player.id === bidState.bidderId)
  const partnerHasBid = currentBidder?.team === aiPlayer.team && currentBidder.id !== aiPlayer.id
  const exceptionalHand = strength >= 31
  if (currentBid === null) return strength >= 14 ? 65 : null
  if (partnerHasBid && !exceptionalHand) return null
  const nextBid = currentBid + 5
  return nextBid <= estimatedBid ? nextBid : null
}

export function chooseAiTrump(hand: Card[]): CardColor {
  const colors: CardColor[] = ['black', 'red', 'yellow', 'green']
  return colors.sort((left, right) => hand.filter((card) => card.kind === 'number' && card.color === right).length - hand.filter((card) => card.kind === 'number' && card.color === left).length)[0]
}

export function chooseAiDiscard(hand: Card[]) {
  return [...hand].filter((card) => card.kind === 'number' && ![5, 10, 14].includes(card.value)).sort((left, right) => (left.kind === 'number' ? left.value : 99) - (right.kind === 'number' ? right.value : 99)).slice(0, 5).map((card) => card.id)
}

export function chooseAiCard(hand: Card[], trick: Trick | undefined, trumpColor?: CardColor, aiPlayer?: PlayerState, bidder?: PlayerState) {
  const knowledge = buildHandKnowledge(trick, trumpColor, bidder, [])
  return chooseAiCardWithKnowledge(hand, knowledge, aiPlayer, bidder)
}

export function chooseAiCardWithKnowledge(hand: Card[], knowledge: HandKnowledge, aiPlayer?: PlayerState, bidder?: PlayerState, players: PlayerState[] = []) {
  const trick = knowledge.currentTrick
  const trumpColor = knowledge.trumpColor
  const leadColor = leadColorForTrick(trick, trumpColor)
  const legalCards = hand.filter((card) => canPlayCard(hand, card, leadColor, trumpColor))
  if (!trick || trick.cards.length === 0) {
    const madeTrump = aiPlayer?.team === knowledge.bidderTeam
    if (madeTrump && hand.some((card) => card.kind === 'crow')) return hand.find((card) => card.kind === 'crow')!
    if (madeTrump && trumpColor) {
      const trumpCards = legalCards.filter((card) => card.kind === 'number' && card.color === trumpColor)
      if (trumpCards.length > 1) return lowestCard(trumpCards)
    }
    const nonTrumpCards = legalCards.filter((card) => card.kind === 'number' && card.color !== trumpColor)
    return highestCard(nonTrumpCards.length ? nonTrumpCards : legalCards)
  }
  const winningCard = trick.cards.reduce((winner, played) => cardBeats(played.card, winner.card, leadColor, trumpColor) ? played : winner, trick.cards[0])
  const winningCards = legalCards.filter((card) => cardBeats(card, winningCard.card, leadColor, trumpColor))
  const currentWinnerPlayer = players.find((player) => player.id === knowledge.currentWinnerId)
  const currentWinnerIsPartner = Boolean(currentWinnerPlayer && aiPlayer && currentWinnerPlayer.team === aiPlayer.team && currentWinnerPlayer.id !== aiPlayer.id)
  if (currentWinnerIsPartner && knowledge.currentTrickPoints > 0) {
    const pointWinners = winningCards.filter((card) => cardPoints(card) > 0)
    if (pointWinners.length) return lowestCard(pointWinners)
  }
  if (winningCards.length) {
    const winningTrump = winningCards.filter((card) => card.kind === 'crow' || (card.kind === 'number' && card.color === trumpColor))
    return highestCard(winningTrump.length ? winningTrump : winningCards)
  }
  const nonTrumpCards = legalCards.filter((card) => card.kind === 'number' && card.color !== trumpColor)
  return lowestCard(nonTrumpCards.length ? nonTrumpCards : legalCards)
}

export function buildHandKnowledge(trick: Trick | undefined, trumpColor: CardColor | undefined, bidder: PlayerState | undefined, completedTricks: Trick[]): HandKnowledge {
  const allTricks = trick ? [...completedTricks, trick] : completedTricks
  const playedCards = allTricks.flatMap((item) => item.cards.map(({ card }) => card))
  const highestPlayedByColor: HandKnowledge['highestPlayedByColor'] = {}
  const voidColorsByPlayer: HandKnowledge['voidColorsByPlayer'] = {}
  allTricks.forEach((item) => {
    const lead = leadColorForTrick(item, trumpColor)
    item.cards.forEach(({ playerId, card }) => {
      if (card.kind === 'number' && (!highestPlayedByColor[card.color] || card.value > highestPlayedByColor[card.color]!.value)) highestPlayedByColor[card.color] = card
      if (lead && card.kind === 'number' && card.color !== lead) voidColorsByPlayer[playerId] = [...new Set([...(voidColorsByPlayer[playerId] ?? []), lead])]
    })
  })
  const currentWinner = trick?.cards.length ? trick.cards.reduce((winner, played) => cardBeats(played.card, winner.card, leadColorForTrick(trick, trumpColor), trumpColor) ? played : winner, trick.cards[0]) : undefined
  return {
    trumpColor,
    bidderId: bidder?.id,
    bidderTeam: bidder?.team,
    trickNumber: completedTricks.length + 1,
    playedCards,
    currentTrick: trick ?? { leaderId: '', cards: [] },
    highestPlayedByColor,
    trumpCardsPlayed: playedCards.filter((card) => card.kind === 'crow' || card.kind === 'number' && card.color === trumpColor),
    voidColorsByPlayer,
    currentWinnerId: currentWinner?.playerId,
    currentWinnerCard: currentWinner?.card,
    currentTrickPoints: trick?.cards.reduce((total, played) => total + cardPoints(played.card), 0) ?? 0,
  }
}

function highestCard(cards: Card[]) {
  return [...cards].sort((left, right) => {
    if (left.kind === 'crow') return -1
    if (right.kind === 'crow') return 1
    return right.value - left.value
  })[0]
}

function lowestCard(cards: Card[]) {
  return [...cards].sort((left, right) => {
    if (left.kind === 'crow') return 1
    if (right.kind === 'crow') return -1
    return left.value - right.value
  })[0]
}
