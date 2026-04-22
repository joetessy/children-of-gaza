import type { PourState } from '../types.ts'

interface BuildArgs {
  count: number
  durationMs: number
  seed?: number
}

const mulberry32 = ({ seed }: { seed: number }): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const buildPour = ({ count, durationMs, seed = 0xa1b2c3d4 }: BuildArgs): PourState => {
  const appearOrder = new Int32Array(count)
  for (let i = 0; i < count; i += 1) appearOrder[i] = i

  const rng = mulberry32({ seed })
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = appearOrder[i]
    appearOrder[i] = appearOrder[j]
    appearOrder[j] = tmp
  }

  return {
    appearOrder,
    appeared: 0,
    startedAt: 0,
    durationMs,
    done: false
  }
}

interface AdvanceArgs {
  pour: PourState
  now: number
  total: number
}

export const advancePour = ({ pour, now, total }: AdvanceArgs): number => {
  if (pour.startedAt === 0) pour.startedAt = now
  if (pour.done) return total

  const elapsed = now - pour.startedAt
  const ratio = Math.min(1, elapsed / pour.durationMs)
  const eased = ratio < 1 ? 1 - Math.pow(1 - ratio, 1.1) : 1
  const target = Math.min(total, Math.round(eased * total))

  pour.appeared = target
  if (target >= total) pour.done = true
  return target
}

export const skipPour = ({ pour, total }: { pour: PourState; total: number }): void => {
  pour.appeared = total
  pour.done = true
}

interface MaskArgs {
  appearOrder: Int32Array
  appeared: number
  mask: Uint8Array
  lastAppeared: number
}

export const syncAppearMask = ({
  appearOrder,
  appeared,
  mask,
  lastAppeared
}: MaskArgs): void => {
  if (appeared === lastAppeared) return
  if (appeared < lastAppeared) {
    mask.fill(0)
    for (let k = 0; k < appeared; k += 1) mask[appearOrder[k]] = 1
    return
  }
  for (let k = lastAppeared; k < appeared; k += 1) mask[appearOrder[k]] = 1
}
