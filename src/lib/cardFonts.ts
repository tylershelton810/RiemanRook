export const COINS_PER_CARD_FONT = 25

export const CARD_FONTS = [
  { id: 'pixel', name: 'Pixel', description: 'Minecraft-style blocky pixel numerals.' },
  { id: 'fancy', name: 'Fancy', description: 'Flourished script numerals with a hand-drawn feel.' },
  { id: 'display', name: 'Display', description: 'Heavy, condensed numerals that fill the corner.' },
  { id: 'serif', name: 'Serif', description: 'Old-fashioned print numerals with tapered strokes.' },
] as const

export type CardFontId = typeof CARD_FONTS[number]['id']

export function isPaidCardFont(fontId: string) {
  return CARD_FONTS.some((font) => font.id === fontId)
}
