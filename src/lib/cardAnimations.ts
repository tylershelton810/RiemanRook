export const COINS_PER_CARD_ANIMATION = 25

export const CARD_ANIMATIONS = [
  { id: 'pulse', name: 'Pulse', description: 'A glowing ring pulses your card’s color outward.' },
  { id: 'wiggle', name: 'Wiggle', description: 'A dashed frame wiggles around your cards.' },
  { id: 'shine', name: 'Shine', description: 'A soft light sweeps across your cards.' },
  { id: 'sparkle', name: 'Sparkle', description: 'Tiny sparkles dance around your cards.' },
] as const

export type CardAnimationId = typeof CARD_ANIMATIONS[number]['id']

export function isPaidCardAnimation(animationId: string) {
  return CARD_ANIMATIONS.some((animation) => animation.id === animationId)
}
