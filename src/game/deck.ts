import { COLORS, type Card } from './types'

export function createDeck(): Card[] {
  const cards: Card[] = COLORS.flatMap((color) => Array.from({ length: 14 }, (_, index) => ({
    id: `${color}-${index + 1}`,
    kind: 'number' as const,
    color,
    value: index + 1,
  })))
  cards.push({ id: 'crow', kind: 'crow' })
  return cards
}

export function shuffleDeck(cards: Card[], random: () => number = Math.random): Card[] {
  const shuffled = [...cards]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

export function dealDeck(cards: Card[], playerCount = 4, cardsPerPlayer = 13, kittySize = 5) {
  if (cards.length !== 57) throw new Error('Crow Rules currently require a 57-card deck.')
  if (playerCount * cardsPerPlayer + kittySize !== 57) throw new Error('Deal parameters must cover the full 57-card deck.')
  const hands = Array.from({ length: playerCount }, () => [] as Card[])
  for (let index = 0; index < playerCount * cardsPerPlayer; index += 1) hands[index % playerCount].push(cards[index])
  return { hands, kitty: cards.slice(playerCount * cardsPerPlayer) }
}
