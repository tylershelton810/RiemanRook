export const COINS_PER_PLACEMENT = 25

export const PLACEMENTS = [
  { id: 'crack', name: 'Crack', description: 'The board cracks as the crow slams down.' },
  { id: 'teleport', name: 'Teleport', description: 'The crow glitches in out of the sky.' },
  { id: 'slam', name: 'Slam', description: 'The crow drops in with a bone-shaking thud.' },
  { id: 'flash', name: 'Flash', description: 'A blinding flash as the crow lands.' },
  { id: 'zoom', name: 'Zoom', description: 'The crow zooms in from across the board.' },
] as const

export type PlacementId = typeof PLACEMENTS[number]['id']

export function isPaidPlacement(placementId: string) {
  return PLACEMENTS.some((placement) => placement.id === placementId)
}
