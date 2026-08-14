import { BUILTIN_CROW_LOGOS } from './crowLogos'

export const TOKENS_PER_CROW_FACE = 10

export const PAID_CROW_LOGOS: string[] = BUILTIN_CROW_LOGOS.filter((logo) => logo.id !== 'classic').map((logo) => logo.id)

export function isPaidCrowLogo(logoId: string) {
  return PAID_CROW_LOGOS.includes(logoId)
}

export function tokensForWinningScore(winningScore: number) {
  return Math.max(1, Math.floor(winningScore / 250))
}
