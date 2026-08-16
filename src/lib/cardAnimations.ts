export const COINS_PER_CARD_ANIMATION = 10

export const CARD_ANIMATIONS = [
  { id: 'pulse', name: 'Pulse', description: 'A glowing ring pulses your rook’s color outward.' },
  { id: 'wiggle', name: 'Wiggle', description: 'Your rook card wiggles itself.' },
  { id: 'wave', name: 'Wave', description: 'A wave ripples around your rook card.' },
  { id: 'shine', name: 'Shine', description: 'A soft light sweeps across your rook card.' },
  { id: 'sparkle', name: 'Sparkle', description: 'Tiny sparkles dance around your rook card.' },
] as const

export type CardAnimationId = typeof CARD_ANIMATIONS[number]['id']

export function isPaidCardAnimation(animationId: string) {
  return CARD_ANIMATIONS.some((animation) => animation.id === animationId)
}
