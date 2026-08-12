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

export function isLegalBid(value: number, currentBid: number | null) {
  const floor = currentBid === null ? riemanRules.bidding.minimum : currentBid + riemanRules.bidding.increment
  return value >= floor && value <= riemanRules.bidding.maximum && value % riemanRules.bidding.increment === 0
}
