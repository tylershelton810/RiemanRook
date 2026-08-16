export const COINS_PER_CARD_FONT = 10

const PREMIUM_CARD_FONTS = ['fire', 'aurora', 'cyber']

export function cardFontPrice(fontId: string) {
  return PREMIUM_CARD_FONTS.includes(fontId) ? 25 : COINS_PER_CARD_FONT
}

export const CARD_FONTS = [
  { id: 'pixel', name: 'Pixel', description: 'Minecraft-style blocky pixel numerals.' },
  { id: 'fancy', name: 'Fancy', description: 'Flourished script numerals with a hand-drawn feel.' },
  { id: 'display', name: 'Display', description: 'Heavy, condensed numerals that fill the corner.' },
  { id: 'serif', name: 'Serif', description: 'Old-fashioned print numerals with tapered strokes.' },
  { id: 'fire', name: 'Liquid', description: 'Your cards glisten — shimmering color, rippling waves, and a drifting haze.' },
  { id: 'aurora', name: 'Aurora', description: 'Cosmic night-sky cards — drifting northern lights and a field of twinkling stars.' },
  { id: 'cyber', name: 'Cyber', description: 'Neon-drenched cards — a pulsing city grid, drifting rain, and glitching numerals.' },
] as const

export type CardFontId = typeof CARD_FONTS[number]['id']

export function isPaidCardFont(fontId: string) {
  return CARD_FONTS.some((font) => font.id === fontId)
}
