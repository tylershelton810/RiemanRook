export function createConfetti(count = 32) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    left: `${(index * 29) % 100}%`,
    delay: `${(index % 8) * 0.08}s`,
    color: ['#ec7765', '#f0b84f', '#286b62', '#827caa'][index % 4],
    rotation: `${(index * 41) % 180}deg`,
  }))
}
