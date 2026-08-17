export type Difficulty = 'Newbie' | 'Average' | 'Skilled'
export type SeatStatus = 'human' | 'ai' | 'open'
export type SeatTeam = 'A' | 'B' | 'C' | 'D' | 'E'

export interface LobbySeat {
  id: string
  name: string
  status: SeatStatus
  team: SeatTeam
  difficulty?: Difficulty
}

export interface LobbySettings {
  ruleset: string
  turnTimer: number
  seats: LobbySeat[]
}
