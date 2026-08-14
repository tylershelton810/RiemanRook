export const COINS_PER_CARD_ANIMATION = 25

export const CARD_ANIMATIONS = [
  { id: 'pulse', name: 'Pulse', description: 'Your cards glow and pulse their color.' },
  { id: 'wiggle', name: 'Wiggle', description: 'Your cards give a gentle wiggle.' },
  { id: 'shine', name: 'Shine', description: 'A soft light sweeps across your cards.' },
  { id: 'sparkle', name: 'Sparkle', description: 'Tiny sparkles dance around your cards.' },
] as const

export type CardAnimationId = typeof CARD_ANIMATIONS[number]['id']

export function isPaidCardAnimation(animationId: string) {
  return CARD_ANIMATIONS.some((animation) => animation.id === animationId)
}
