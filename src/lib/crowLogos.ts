export const BUILTIN_CROW_LOGOS = [
  { id: 'classic', name: 'Classic' },
  { id: 'bird', name: 'Bird' },
  { id: 'party', name: 'Party' },
  { id: 'cool', name: 'Cool' },
  { id: 'crown', name: 'Crowned' },
  { id: 'chef', name: 'Chef' },
  { id: 'fox', name: 'Fox' },
  { id: 'owl', name: 'Owl' },
  { id: 'cat', name: 'Cat' },
  { id: 'panda', name: 'Panda' },
] as const

export type BuiltinCrowLogoId = typeof BUILTIN_CROW_LOGOS[number]['id']
