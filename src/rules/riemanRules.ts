export const riemanRules = {
  id: 'rieman-rules',
  name: 'Rieman Rules',
  winningScore: 500,
  deck: { colors: ['black', 'red', 'yellow', 'green'], cardsPerColor: 14, crowCards: 1 },
  deal: { cardsPerPlayer: 13, kittySize: 5 },
  bidding: { minimum: 65, increment: 5, maximum: 110, dealerTakesMinimumOnAllPass: true },
  cardPoints: { crow: 10, five: 5, ten: 10, fourteen: 10 },
  turnTimerSeconds: 30,
  clockwise: true,
} as const

export type RiemanRules = typeof riemanRules

export const riemanRules5Handed = {
  id: 'rieman-rules-5',
  name: 'Rieman Rook 5 Handed',
  winningScore: 500,
  deck: { colors: ['black', 'red', 'yellow', 'green'], cardsPerColor: 14, crowCards: 1 },
  deal: { cardsPerPlayer: 11, kittySize: 2 },
  bidding: { minimum: 60, increment: 5, maximum: 105, dealerTakesMinimumOnAllPass: true },
  cardPoints: { crow: 10, five: 5, ten: 10, fourteen: 10 },
  turnTimerSeconds: 30,
  clockwise: true,
} as const

export type RiemanRules5Handed = typeof riemanRules5Handed

export type RiemanRuleset = typeof riemanRules | typeof riemanRules5Handed

export function isLegalBid(value: number, currentBid: number | null, ruleset: RiemanRuleset = riemanRules) {
  const floor = currentBid === null ? ruleset.bidding.minimum : currentBid + ruleset.bidding.increment
  return value >= floor && value <= ruleset.bidding.maximum && value % ruleset.bidding.increment === 0
}
