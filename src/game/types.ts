import type { Difficulty } from '../lib/types'

export const COLORS = ['black', 'red', 'yellow', 'green'] as const
export type CardColor = typeof COLORS[number]
export type Team = 'A' | 'B'

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
}

export interface HandState {
  phase: 'bidding' | 'trump' | 'kitty' | 'playing' | 'complete'
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
  teamPoints?: Record<Team, number>
  winningTeam?: Team
  bidderTeam?: Team
  bidMade?: boolean
  scoreDelta?: Record<Team, number>
  gameWinner?: Team
}

export interface SessionState {
  id: string
  status: 'lobby' | 'active' | 'completed' | 'unfinished'
  players: PlayerState[]
  scores: Record<Team, number>
  handNumber: number
  winningScore: number
  stats: Record<string, PlayerSessionStats>
  hand?: HandState
}

export interface PlayerSessionStats {
  handsPlayed: number
  handsBid: number
  winningBids: number
  colors: Partial<Record<CardColor, number>>
  partners: Record<string, number>
}
