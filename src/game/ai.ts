import { canPlayCard, cardBeats, leadColorForTrick } from './rules'
import { cardPoints } from './rules'
import { COLORS, type Card, type CardColor, type HandKnowledge, type HandState, type NumberCard, type PlayerState, type Trick } from './types'
import { riemanRules } from '../rules/riemanRules'

const TRUMP_TOTAL = riemanRules.deck.cardsPerColor + riemanRules.deck.crowCards
const HIGH_CARD_STRENGTH: Record<number, number> = { 14: 8, 13: 5, 12: 3, 11: 2, 10: 2 }
const CROW_STRENGTH = 12
const OPENING_BAR = 20
const CEILING_FLOOR_STRENGTH = 10
const DUMP_NUDGE_TRUMP_HIGH = 8
const DUMP_NUDGE_MIN_DUMP = 12
const CROW_DEPTH_NUDGE_MIN_DEPTH = 4
const POINT_VALUES = new Set([5, 10, 14])
const BOSS_COMPANION_MIN = 13

function evaluateTrumpSuit(hand: Card[], trumpColor: CardColor) {
  const numbers = hand.filter((card): card is NumberCard => card.kind === 'number')
  const trumpCards = numbers.filter((card) => card.color === trumpColor)
  const high = trumpCards.reduce((total, card) => total + (HIGH_CARD_STRENGTH[card.value] ?? 0), 0)
  const depth = Math.max(0, trumpCards.length - 2) * 2
  const crow = hand.some((card) => card.kind === 'crow') ? CROW_STRENGTH : 0
  const control = high + depth + crow
  const dump = COLORS.reduce((total, color) => {
    if (color === trumpColor) return total
    const suit = numbers.filter((card) => card.color === color)
    if (suit.length === 0) return total
    const hasFiveOrTen = suit.some((card) => card.value === 5 || card.value === 10)
    const hasFourteen = suit.some((card) => card.value === 14)
    if (!hasFiveOrTen && !hasFourteen) return total + suit.length * 2
    if (hasFourteen && !hasFiveOrTen) return total + (suit.length - 1) * 1.5
    if (hasFourteen) return total + (suit.length - suit.filter((card) => card.value === 5 || card.value === 10 || card.value === 14).length)
    return total
  }, 0)
  return { control, high, dump, depth, crow, score: control + dump }
}

export function chooseAiBid(hand: Card[], currentBid: number | null, aiPlayer: PlayerState, players: PlayerState[], bidState: HandState) {
  const best = COLORS.reduce((winner, color) => {
    const candidate = evaluateTrumpSuit(hand, color)
    return candidate.score > winner.score ? candidate : winner
  }, evaluateTrumpSuit(hand, COLORS[0]))
  const riskShift = aiPlayer.difficulty === 'Skilled' ? 5 : aiPlayer.difficulty === 'Newbie' ? -5 : 0
  const dumpNudge = best.high >= DUMP_NUDGE_TRUMP_HIGH && best.dump >= DUMP_NUDGE_MIN_DUMP ? 5 : 0
  const crowDepthNudge = best.crow && best.depth >= CROW_DEPTH_NUDGE_MIN_DEPTH ? 5 : 0
  const ceiling = Math.min(90, Math.max(65, 65 + Math.floor(Math.max(0, best.control - CEILING_FLOOR_STRENGTH) / 5) * 5 + dumpNudge + crowDepthNudge + riskShift))
  if (best.score < OPENING_BAR) return null
  if (currentBid === null) return 65
  const currentBidder = players.find((player) => player.id === bidState.bidderId)
  const partnerHasBid = Boolean(currentBidder && currentBidder.team === aiPlayer.team && currentBidder.id !== aiPlayer.id)
  if (partnerHasBid) return ceiling >= currentBid + 10 ? currentBid + 5 : null
  const nextBid = currentBid + 5
  return nextBid <= ceiling ? nextBid : null
}

export function chooseAiTrump(hand: Card[]): CardColor {
  return planKitty(hand).trump
}

export function planKitty(hand: Card[]): { trump: CardColor; discardIds: string[] } {
  const numbers = hand.filter((card): card is NumberCard => card.kind === 'number')
  const trump = COLORS.reduce<{ color: CardColor; score: number }>((best, color) => {
    const score = evaluateTrumpSuit(hand, color).score
    return score > best.score ? { color, score } : best
  }, { color: COLORS[0], score: -Infinity }).color
  const voidable: NumberCard[][] = []
  const bossPools: NumberCard[][] = []
  const protectedPools: NumberCard[][] = []
  for (const color of COLORS) {
    if (color === trump) continue
    const suit = numbers.filter((card) => card.color === color)
    const count = suit.filter((card) => POINT_VALUES.has(card.value))
    const nonCount = suit.filter((card) => !POINT_VALUES.has(card.value))
    if (count.length === 0) {
      voidable.push(nonCount)
      continue
    }
    const descending = [...nonCount].sort((a, b) => b.value - a.value)
    const kept = new Set<NumberCard>()
    if (count.some((card) => card.value === 14) && descending[0] && descending[0].value >= BOSS_COMPANION_MIN) kept.add(descending[0])
    if (count.some((card) => card.value === 5 || card.value === 10)) {
      const protector = descending.find((card) => !kept.has(card))
      if (protector) kept.add(protector)
    }
    const shed = descending.filter((card) => !kept.has(card))
    ;(count.some((card) => card.value === 14) ? bossPools : protectedPools).push(shed)
  }
  const chosen: NumberCard[] = []
  const takeLowest = (cards: NumberCard[], target: number) => {
    const sorted = [...cards].sort((a, b) => a.value - b.value)
    while (chosen.length < target && sorted.length) chosen.push(sorted.shift()!)
  }
  for (const suit of [...voidable].sort((a, b) => a.length - b.length)) {
    takeLowest(suit, 5)
    if (chosen.length >= 5) break
  }
  for (const suit of bossPools) {
    takeLowest(suit, 5)
    if (chosen.length >= 5) break
  }
  if (chosen.length < 5) takeLowest(protectedPools.flat(), 5)
  if (chosen.length < 5) {
    const trumpNumbers = numbers.filter((card) => card.color === trump && !POINT_VALUES.has(card.value))
    takeLowest(trumpNumbers.filter((card) => !chosen.includes(card)), 5)
  }
  return { trump, discardIds: chosen.slice(0, 5).map((card) => card.id) }
}

export function chooseAiDiscard(hand: Card[]) {
  return planKitty(hand).discardIds
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
    return chooseLeadCard(hand, knowledge, aiPlayer, players)
  }
  const winningCard = trick.cards.reduce((winner, played) => cardBeats(played.card, winner.card, leadColor, trumpColor) ? played : winner, trick.cards[0])
  const winningCards = legalCards.filter((card) => cardBeats(card, winningCard.card, leadColor, trumpColor))
  const currentWinnerPlayer = players.find((player) => player.id === knowledge.currentWinnerId)
  const currentWinnerIsPartner = Boolean(currentWinnerPlayer && aiPlayer && currentWinnerPlayer.team === aiPlayer.team && currentWinnerPlayer.id !== aiPlayer.id)
  if (currentWinnerIsPartner) {
    const nonBeating = legalCards.filter((card) => !cardBeats(card, winningCard.card, leadColor, trumpColor))
    const safePoints = nonBeating.filter((card) => cardPoints(card) > 0)
    if (safePoints.length) return [...safePoints].sort((left, right) => cardPoints(right) - cardPoints(left) || rankForLowest(left) - rankForLowest(right))[0]
    if (nonBeating.length) {
      const nonBeatingNonTrump = nonBeating.filter((card) => card.kind === 'number' && card.color !== trumpColor)
      return lowestCard(nonBeatingNonTrump.length ? nonBeatingNonTrump : nonBeating)
    }
  }
  if (winningCards.length) {
    const winningTrump = winningCards.filter((card) => card.kind === 'crow' || (card.kind === 'number' && card.color === trumpColor))
    return lowestCard(winningTrump.length ? winningTrump : winningCards)
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

function chooseLeadCard(hand: Card[], knowledge: HandKnowledge, aiPlayer?: PlayerState, players: PlayerState[] = []): Card {
  const trumpColor = knowledge.trumpColor
  const madeTrump = Boolean(aiPlayer && aiPlayer.team === knowledge.bidderTeam)
  if (madeTrump && trumpColor) {
    const myTrump = hand.filter((card) => card.kind === 'crow' || (card.kind === 'number' && card.color === trumpColor))
    const trumpLeft = TRUMP_TOTAL - myTrump.length - knowledge.trumpCardsPlayed.length
    const opponentsOut = trumpLeft <= 0 || opponentsVoidInTrump(knowledge, aiPlayer, players)
    if (!opponentsOut && myTrump.length) {
      const myHighest = highestCard(myTrump)
      const myHighestValue = myHighest.kind === 'crow' ? 15 : myHighest.value
      const currentHighest = highestRemainingTrump(knowledge, trumpColor)
      if (myHighestValue >= currentHighest) return myHighest
      const nonPointTrump = myTrump.filter((card) => card.kind === 'number' && !POINT_VALUES.has(card.value))
      if (nonPointTrump.length) return lowestCard(nonPointTrump)
    }
  }
  if (!madeTrump && trumpColor) {
    for (const suit of COLORS) {
      if (suit === trumpColor) continue
      const highestRemaining = highestRemainingInSuit(knowledge, suit)
      const boss = hand.find((card) => card.kind === 'number' && card.color === suit && card.value === highestRemaining)
      if (boss) return boss
    }
  }
  const nonPointOffSuit = hand.filter((card) => card.kind === 'number' && card.color !== trumpColor && !POINT_VALUES.has(card.value))
  return lowestCard(nonPointOffSuit.length ? nonPointOffSuit : hand)
}

function highestRemainingTrump(knowledge: HandKnowledge, trumpColor: CardColor): number {
  const played = new Set(knowledge.trumpCardsPlayed.filter((card): card is NumberCard => card.kind === 'number').map((card) => card.value))
  for (let value = 14; value >= 1; value--) if (!played.has(value)) return value
  return 0
}

function highestRemainingInSuit(knowledge: HandKnowledge, suit: CardColor): number {
  const played = new Set(knowledge.playedCards.filter((card): card is NumberCard => card.kind === 'number' && card.color === suit).map((card) => card.value))
  for (let value = 14; value >= 1; value--) if (!played.has(value)) return value
  return 0
}

function opponentsVoidInTrump(knowledge: HandKnowledge, aiPlayer: PlayerState | undefined, players: PlayerState[]): boolean {
  const trumpColor = knowledge.trumpColor
  if (!trumpColor || !aiPlayer) return false
  const opponents = players.filter((player) => player.team !== aiPlayer.team && player.id !== aiPlayer.id)
  return opponents.length > 0 && opponents.every((opponent) => (knowledge.voidColorsByPlayer[opponent.id] ?? []).includes(trumpColor))
}

function lowestCard(cards: Card[]) {
  return [...cards].sort((left, right) => {
    if (left.kind === 'crow') return 1
    if (right.kind === 'crow') return -1
    return left.value - right.value
  })[0]
}

function rankForLowest(card: Card) {
  return card.kind === 'crow' ? 15 : card.value
}
