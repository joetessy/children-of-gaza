import type { StarGeometry } from '../types.ts'

interface BuildArgs {
  count: number
  width: number
  height: number
}

// ── deterministic RNG ─────────────────────────────────────────────────────────

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

const hash = (n: number): number => {
  let x = n | 0
  x = (x ^ 61) ^ (x >>> 16)
  x = x + (x << 3)
  x = x ^ (x >>> 4)
  x = Math.imul(x, 0x27d4eb2d)
  x = x ^ (x >>> 15)
  return x >>> 0
}

// ── density map ───────────────────────────────────────────────────────────────
// Returns a value in [0, 1] — higher = more stars there.
// Uses normalised coordinates (0–1) so it's viewport-agnostic.

const densityAt = ({ xn, yn }: { xn: number; yn: number }): number => {
  // Diagonal Milky-Way band drifting bottom-left → top-right
  const band =
    Math.exp(-Math.pow((yn - xn * 0.65 - 0.05) * 3.2, 2)) * 0.85

  // Three organic clusters
  const c1 =
    Math.exp(
      -(Math.pow(xn - 0.7, 2) * 18 + Math.pow(yn - 0.18, 2) * 22)
    ) * 0.65
  const c2 =
    Math.exp(
      -(Math.pow(xn - 0.25, 2) * 14 + Math.pow(yn - 0.75, 2) * 16)
    ) * 0.55
  const c3 =
    Math.exp(
      -(Math.pow(xn - 0.52, 2) * 26 + Math.pow(yn - 0.42, 2) * 32)
    ) * 0.38

  // Baseline — ensures every corner still gets stars
  const baseline = 0.28

  return Math.min(1, baseline + band + c1 + c2 + c3)
}

// ── placement ─────────────────────────────────────────────────────────────────

const placeStars = ({
  count,
  width,
  height,
  rng
}: {
  count: number
  width: number
  height: number
  rng: () => number
}): Float32Array => {
  const MARGIN = 20
  const iw = width - MARGIN * 2
  const ih = height - MARGIN * 2

  // Rejection sampling against the density map.
  // Pre-scan to find max density (always 1 for our map, but be explicit).
  const maxD = 1

  const out = new Float32Array(count * 2)
  let placed = 0
  let attempts = 0
  const maxAttempts = count * 40

  while (placed < count && attempts < maxAttempts) {
    attempts += 1
    const rx = rng()
    const ry = rng()
    const d = densityAt({ xn: rx, yn: ry }) / maxD
    if (rng() > d) continue
    out[placed * 2] = MARGIN + rx * iw
    out[placed * 2 + 1] = MARGIN + ry * ih
    placed += 1
  }

  // If rejection left us short (shouldn't happen), fill remainder uniformly
  while (placed < count) {
    out[placed * 2] = MARGIN + rng() * iw
    out[placed * 2 + 1] = MARGIN + rng() * ih
    placed += 1
  }

  return out
}

// ── main export ───────────────────────────────────────────────────────────────

export const buildGeometry = ({ count, width, height }: BuildArgs): StarGeometry => {
  const rng = mulberry32({ seed: 0xcafef00d })
  const positions = placeStars({ count, width, height, rng })

  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const brightness = new Float32Array(count)
  const speeds = new Float32Array(count)
  const amplitudes = new Float32Array(count)
  const styles = new Uint8Array(count) // 0=slow, 1=fast, 2=shimmer

  for (let i = 0; i < count; i += 1) {
    const h1 = hash(i + 0x9e3779b9) / 0xffffffff
    const h2 = hash(i + 0x85ebca77) / 0xffffffff
    const h3 = hash(i + 0xc2b2ae3d) / 0xffffffff
    const h4 = hash(i + 0x6c62272e) / 0xffffffff
    const h5 = hash(i + 0x517cc1b7) / 0xffffffff

    // Size: mostly tiny — only ~1% get large, ~6% medium
    const sizeCurve = h1 * h1
    if (sizeCurve > 0.99) {
      sizes[i] = 1.8 + h2 * 0.4  // rare bright (~1%)
    } else if (sizeCurve > 0.93) {
      sizes[i] = 1.1 + h2 * 0.4  // medium (~6%)
    } else {
      sizes[i] = 0.5 + h2 * 0.5  // dim background (~93%)
    }

    phases[i] = h3 * Math.PI * 2
    brightness[i] = 0.38 + h4 * 0.48

    // Twinkle style — calmer overall
    if (h5 < 0.02) {
      styles[i] = 2 // shimmer (2%)
      speeds[i] = 2.2 + h1 * 2.0
      amplitudes[i] = 0.13 + h2 * 0.09
    } else if (h5 < 0.10) {
      styles[i] = 1 // fast twinkle (8%)
      speeds[i] = 1.2 + h1 * 1.4
      amplitudes[i] = 0.09 + h2 * 0.08
    } else {
      styles[i] = 0 // slow breathe (90%)
      speeds[i] = 0.18 + h1 * 0.55
      amplitudes[i] = 0.04 + h2 * 0.06
    }
  }

  const cellSize = Math.max(16, Math.ceil(Math.sqrt((width * height) / count) * 1.8))
  const gridCols = Math.ceil(width / cellSize)
  const gridRows = Math.ceil(height / cellSize)

  const buckets: number[][] = []
  for (let i = 0; i < gridCols * gridRows; i += 1) buckets.push([])

  for (let i = 0; i < count; i += 1) {
    const gx = Math.min(gridCols - 1, Math.max(0, Math.floor(positions[i * 2] / cellSize)))
    const gy = Math.min(gridRows - 1, Math.max(0, Math.floor(positions[i * 2 + 1] / cellSize)))
    buckets[gy * gridCols + gx].push(i)
  }

  const gridStarts = new Int32Array(gridCols * gridRows + 1)
  let total = 0
  for (let b = 0; b < buckets.length; b += 1) {
    gridStarts[b] = total
    total += buckets[b].length
  }
  gridStarts[buckets.length] = total

  const grid = new Int32Array(total)
  let cursor = 0
  for (const bucket of buckets) {
    for (const idx of bucket) {
      grid[cursor] = idx
      cursor += 1
    }
  }

  return {
    positions, sizes, phases, brightness,
    speeds, amplitudes, styles,
    cellSize, gridCols, gridRows,
    grid, gridStarts, width, height
  }
}

// ── hover lookup ──────────────────────────────────────────────────────────────

interface FindArgs {
  geometry: StarGeometry
  appearedMask: Uint8Array
  x: number
  y: number
  maxDistance: number
}

export const findNearestStar = ({
  geometry,
  appearedMask,
  x,
  y,
  maxDistance
}: FindArgs): number | null => {
  const { positions, cellSize, gridCols, gridRows, grid, gridStarts } = geometry
  const cx = Math.floor(x / cellSize)
  const cy = Math.floor(y / cellSize)
  let best = -1
  let bestDist = maxDistance * maxDistance

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const gx = cx + dx
      const gy = cy + dy
      if (gx < 0 || gy < 0 || gx >= gridCols || gy >= gridRows) continue
      const bucket = gy * gridCols + gx
      const start = gridStarts[bucket]
      const end = gridStarts[bucket + 1]
      for (let k = start; k < end; k += 1) {
        const idx = grid[k]
        if (!appearedMask[idx]) continue
        const px = positions[idx * 2]
        const py = positions[idx * 2 + 1]
        const d2 = (px - x) * (px - x) + (py - y) * (py - y)
        if (d2 < bestDist) {
          bestDist = d2
          best = idx
        }
      }
    }
  }

  return best < 0 ? null : best
}
