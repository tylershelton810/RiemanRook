import { riemanRules, isLegalBid as isLegalBidForRuleset } from '../rules/riemanRules'
import type { RiemanRuleset } from '../rules/riemanRules'
import type { Card, CardColor, Team, Trick } from './types'

export function leadColorForTrick(trick: Trick | undefined, trumpColor?: CardColor) {
  const leadCard = trick?.cards[0]?.card
  if (!leadCard) return undefined
  return leadCard.kind === 'crow' ? trumpColor : leadCard.color
}

export function isLegalBid(amount: number, currentBid: number | null, ruleset: RiemanRuleset = riemanRules) {
  return isLegalBidForRuleset(amount, currentBid, ruleset)
}

export function canPlayCard(hand: Card[], card: Card, leadColor?: CardColor, trumpColor?: CardColor) {
  if (!leadColor) return true
  const hasLeadColor = hand.some((candidate) => candidate.kind === 'number' && candidate.color === leadColor)
  // Crow is trump. It may be played when trump is led, or when the player
  // is void in the color led. It cannot be used to avoid following color.
  if (card.kind === 'crow') return leadColor === trumpColor || !hasLeadColor
  if (!hasLeadColor) return true
  return card.kind === 'number' && card.color === leadColor
}

export function cardBeats(candidate: Card, currentWinner: Card, leadColor?: CardColor, trumpColor?: CardColor) {
  if (candidate.kind === 'crow') return currentWinner.kind !== 'crow'
  if (currentWinner.kind === 'crow') return false
  if (trumpColor) {
    const candidateIsTrump = candidate.color === trumpColor
    const winnerIsTrump = currentWinner.color === trumpColor
    if (candidateIsTrump !== winnerIsTrump) return candidateIsTrump
    if (candidateIsTrump && winnerIsTrump) return candidate.value > currentWinner.value
  }
  if (leadColor) {
    const candidateIsLead = candidate.color === leadColor
    const winnerIsLead = currentWinner.color === leadColor
    if (candidateIsLead !== winnerIsLead) return candidateIsLead
    if (!candidateIsLead && !winnerIsLead) return false
  }
  return candidate.value > currentWinner.value
}

export function cardPoints(card: Card) {
  if (card.kind === 'crow') return 10
  if (card.value === 5) return 5
  if (card.value === 10 || card.value === 14) return 10
  return 0
}

export function pointsInCards(cards: Card[]) {
  return cards.reduce((total, card) => total + cardPoints(card), 0)
}

export function scoreBiddingTeam(bid: number, capturedPoints: number) {
  return capturedPoints >= bid ? capturedPoints : -bid
}

export function winningTeam(team: Team, scores: Record<Team, number>) {
  if (scores.A > 500 && scores.B > 500) return team
  if (scores.A > 500) return 'A'
  if (scores.B > 500) return 'B'
  return null
}
