export type HazardKind = 'slick' | 'sticky' | 'cone' | 'sweeper'

export type Hazard = {
  id: number
  kind: HazardKind
  name: string
  s: number
  x: number
  along: number
  lateral: number
  phase: number
  amp: number
  freq: number
}

export type HazardSample = {
  s: number
  width: number
  curv: number
  pad: number
}

const NAMES: Record<HazardKind, string[]> = {
  slick: ['Wet Signature', 'Gloss Puddle', 'Midnight Spill'],
  sticky: ['Gum Blot', 'Tar Kiss', 'Honey Trap'],
  cone: ['Curb Teeth', 'Nose Check', 'Rail Stack'],
  sweeper: ['Page Sweeper', 'Ink Roller'],
}

export function hazardX(h: Hazard, time: number): number {
  if (h.kind !== 'sweeper') return h.x
  return Math.sin(time * h.freq + h.phase) * h.amp
}

export function placeHazards(samples: HazardSample[], spacing: number): Hazard[] {
  const n = samples.length
  if (n < 16) return []
  const taken = new Uint8Array(n)
  const guard = Math.max(6, Math.round(36 / spacing))
  for (let i = 0; i < guard; i++) {
    taken[i] = 1
    taken[n - 1 - i] = 1
  }
  for (let i = 0; i < n; i++) {
    if (!samples[i].pad) continue
    const span = Math.max(4, Math.round(14 / spacing))
    for (let k = -span; k <= span; k++) taken[(i + k + n) % n] = 1
  }

  const hazards: Hazard[] = []
  let id = 1
  const reserve = (index: number, span: number) => {
    for (let k = -span; k <= span; k++) taken[(index + k + n) % n] = 1
  }
  const bestIndex = (scoreOf: (sample: HazardSample, index: number) => number): number => {
    let best = -1
    let bestScore = -Infinity
    for (let i = 0; i < n; i++) {
      if (taken[i] || samples[i].pad) continue
      const score = scoreOf(samples[i], i)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  const sideOf = (curv: number, flip: number) => {
    const sign = curv >= 0 ? 1 : -1
    return sign * (flip ? -1 : 1)
  }

  for (let c = 0; c < 3; c++) {
    const index = bestIndex((sample) => Math.abs(sample.curv) * sample.width)
    if (index < 0) break
    const sample = samples[index]
    const side = sideOf(sample.curv, 0)
    hazards.push({
      id: id++,
      kind: 'slick',
      name: NAMES.slick[c % NAMES.slick.length],
      s: sample.s,
      x: side * sample.width * 0.3,
      along: 5.4,
      lateral: 2.05,
      phase: 0,
      amp: 0,
      freq: 0,
    })
    reserve(index, Math.round(32 / spacing))
  }

  for (let c = 0; c < 2; c++) {
    const index = bestIndex((sample) => sample.width / (0.008 + Math.abs(sample.curv)))
    if (index < 0) break
    const sample = samples[index]
    const side = c % 2 === 0 ? 1 : -1
    hazards.push({
      id: id++,
      kind: 'sticky',
      name: NAMES.sticky[c % NAMES.sticky.length],
      s: sample.s,
      x: side * sample.width * 0.36,
      along: 4.4,
      lateral: 1.7,
      phase: 0,
      amp: 0,
      freq: 0,
    })
    reserve(index, Math.round(30 / spacing))
  }

  for (let c = 0; c < 2; c++) {
    const index = bestIndex((sample) => (sample.width * 0.4) / (0.01 + Math.abs(sample.curv)))
    if (index < 0) break
    const sample = samples[index]
    const side = c % 2 === 0 ? -1 : 1
    hazards.push({
      id: id++,
      kind: 'cone',
      name: NAMES.cone[c % NAMES.cone.length],
      s: sample.s,
      x: side * sample.width * 0.4,
      along: 2.4,
      lateral: 1.15,
      phase: 0,
      amp: 0,
      freq: 0,
    })
    reserve(index, Math.round(26 / spacing))
  }

  for (let c = 0; c < 2; c++) {
    const index = bestIndex((sample, i) => {
      const straight = 1 / (0.006 + Math.abs(sample.curv))
      const stagger = 1 + ((i * 3) % 7) * 0.01
      return sample.width * straight * stagger
    })
    if (index < 0) break
    const sample = samples[index]
    hazards.push({
      id: id++,
      kind: 'sweeper',
      name: NAMES.sweeper[c % NAMES.sweeper.length],
      s: sample.s,
      x: 0,
      along: 1.7,
      lateral: 1.25,
      phase: c * 1.7,
      amp: sample.width * 0.2,
      freq: 0.85 + c * 0.15,
    })
    reserve(index, Math.round(40 / spacing))
  }

  return hazards
}
