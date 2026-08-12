export type Difficulty = 'Newbie' | 'Average' | 'Skilled'
export type SeatStatus = 'human' | 'ai' | 'open'

export interface LobbySeat {
  id: string
  name: string
  status: SeatStatus
  team: 'A' | 'B'
  difficulty?: Difficulty
}

export interface LobbySettings {
  ruleset: string
  turnTimer: number
  seats: LobbySeat[]
}
