import type { Difficulty } from '../lib/types'

export const COLORS = ['black', 'red', 'yellow', 'green'] as const
export type CardColor = typeof COLORS[number]
export type Team = 'A' | 'B' | 'C' | 'D' | 'E'

export interface NumberCard {
  id: string
  kind: 'number'
  color: CardColor
  value: number
}

export interface CrowCard {
  id: 'crow'
  kind: 'crow'
}

export type Card = NumberCard | CrowCard

export interface PlayerState {
  id: string
  name: string
  team: Team
  hand: Card[]
  connected: boolean
  isAi: boolean
  difficulty?: Difficulty
}

export interface BidState {
  playerId: string
  amount: number | null
  passed: boolean
}

export interface Trick {
  leaderId: string
  cards: Array<{ playerId: string; card: Card }>
  winnerId?: string
  visibleUntil?: number
}

export interface HandKnowledge {
  trumpColor?: CardColor
  bidderId?: string
  bidderTeam?: Team
  trickNumber: number
  playedCards: Card[]
  currentTrick: Trick
  highestPlayedByColor: Partial<Record<CardColor, NumberCard>>
  trumpCardsPlayed: Card[]
  voidColorsByPlayer: Partial<Record<string, CardColor[]>>
  currentWinnerId?: string
  currentWinnerCard?: Card
  currentTrickPoints: number
  calledCard?: Card
  partnerId?: string
  partnershipRevealed?: boolean
  alone?: boolean
}

export interface HandState {
  phase: 'bidding' | 'trump' | 'calling' | 'kitty' | 'playing' | 'complete'
  dealerIndex: number
  biddingPlayerIndex: number
  currentPlayerIndex: number
  currentBid: number | null
  bidderId?: string
  trumpColor?: CardColor
  bids: BidState[]
  kitty: Card[]
  kittyReveal?: Card[]
  tricks: Trick[]
  completed: boolean
  teamPoints?: Record<string, number>
  winningTeam?: Team
  bidderTeam?: Team
  bidMade?: boolean
  scoreDelta?: Record<string, number>
  gameWinner?: Team
  calledCard?: Card
  partnerId?: string
  partnershipRevealed?: boolean
  alone?: boolean
  pairPoints?: number
  trioPoints?: number
  winnerPlayerIds?: string[]
}

export type RulesetId = 'rieman-rules' | 'rieman-rules-5'

export interface SessionState {
  id: string
  status: 'lobby' | 'active' | 'completed' | 'unfinished'
  players: PlayerState[]
  scores: Record<string, number>
  handNumber: number
  winningScore: number
  stats: Record<string, PlayerSessionStats>
  rulesetId?: RulesetId
  hand?: HandState
}

export interface PlayerSessionStats {
  handsPlayed: number
  handsBid: number
  winningBids: number
  colors: Partial<Record<CardColor, number>>
  partners: Record<string, number>
}
