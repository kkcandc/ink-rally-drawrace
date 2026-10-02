import { clamp } from './format'
import type { RuntimeStats } from './ink'
import { TUNE } from './tune'
import { frameAt, type BuiltTrack } from './tracks'

export type Input = {
  steer: number
  brake: number
  drift: boolean
  boost: boolean
}

export type AiProfile = {
  skill: number
  aggression: number
  lineBias: number
  seed: number
}

export type GhostFrame = { p: number; x: number; h: number }

export type RacerSpec = {
  id: string
  name: string
  color: string
  stats: RuntimeStats
  isPlayer?: boolean
  isGhost?: boolean
  ai?: AiProfile | null
  ghost?: { frames: GhostFrame[]; dt: number } | null
}

export type SimEvent =
  | { type: 'go' }
  | { type: 'lap'; lap: number }
  | { type: 'finish' }
  | { type: 'pad' }
  | { type: 'hit' }
  | { type: 'boost' }
  | { type: 'drift' }

export type SimRacer = {
  id: string
  name: string
  color: string
  stats: RuntimeStats
  isPlayer: boolean
  isGhost: boolean
  ai: AiProfile | null
  ghost: { frames: GhostFrame[]; dt: number } | null
  s: number
  x: number
  v: number
  vx: number
  heading: number
  boost: number
  boosting: boolean
  drifting: boolean
  wasDrifting: boolean
  driftHold: number
  lapStart: number
  lapsDone: number
  crossedOnce: boolean
  finished: boolean
  finishTime: number | null
  lastLap: number | null
  bestLap: number | null
  lastPad: number
  offPad: number
  scrapeTime: number
  scraping: boolean
  hot: boolean
  draft: number
  announcedFinish: boolean
}

export type Sim = {
  track: BuiltTrack
  laps: number
  time: number
  countdown: number
  started: boolean
  rubber: boolean
  racers: SimRacer[]
  events: SimEvent[]
}

const ZERO: Input = { steer: 0, brake: 0, drift: false, boost: false }

export function createRace(opts: {
  track: BuiltTrack
  laps: number
  specs: RacerSpec[]
  skipCountdown?: boolean
  rubber?: boolean
}): Sim {
  const specs = opts.specs
  const racers: SimRacer[] = specs.map((spec, i) => {
    const row = Math.floor(i / 2)
    const col = i % 2
    const s = opts.track.length - 14 - row * 8 - col * 1.5
    return {
      id: spec.id,
      name: spec.name,
      color: spec.color,
      stats: spec.stats,
      isPlayer: !!spec.isPlayer,
      isGhost: !!spec.isGhost,
      ai: spec.ai ?? null,
      ghost: spec.ghost ?? null,
      s,
      x: col === 0 ? -1.7 : 1.7,
      v: 0,
      vx: 0,
      heading: 0,
      boost: 0.18,
      boosting: false,
      drifting: false,
      wasDrifting: false,
      driftHold: 0,
      lapStart: 0,
      lapsDone: 0,
      crossedOnce: false,
      finished: false,
      finishTime: null,
      lastLap: null,
      bestLap: null,
      lastPad: 0,
      offPad: 0,
      scrapeTime: 0,
      scraping: false,
      hot: false,
      draft: 0,
      announcedFinish: false,
    }
  })
  return {
    track: opts.track,
    laps: opts.laps,
    time: 0,
    countdown: opts.skipCountdown ? 0 : 3.15,
    started: !!opts.skipCountdown,
    rubber: opts.rubber ?? true,
    racers,
    events: [],
  }
}

export function progressOf(r: SimRacer, length: number): number {
  const into = r.crossedOnce ? r.s : r.s - length
  return r.lapsDone * length + into
}

export function standings(sim: Sim): SimRacer[] {
  const live = sim.racers.filter((r) => !r.isGhost)
  const done = live
    .filter((r) => r.finished)
    .sort((a, b) => (a.finishTime ?? 0) - (b.finishTime ?? 0))
  const rest = live
    .filter((r) => !r.finished)
    .sort((a, b) => progressOf(b, sim.track.length) - progressOf(a, sim.track.length))
  return [...done, ...rest]
}

export function placeOf(sim: Sim, id: string): number {
  const rows = standings(sim)
  const i = rows.findIndex((r) => r.id === id)
  return i < 0 ? rows.length : i + 1
}

export function cornerSafeSpeed(track: BuiltTrack, s: number, gripCoef: number): number {
  let worst = 0.008
  for (let d = 6; d <= 36; d += 4) {
    worst = Math.max(worst, Math.abs(frameAt(track, s + d).curv))
  }
  const maxA = 6.5 + gripCoef * 6.2
  const usable = maxA * Math.sin(TUNE.maxHeading) * 0.9
  return Math.sqrt(usable / (worst * TUNE.centrifugal))
}

function signedDelta(a: number, b: number, length: number): number {
  let d = a - b
  if (d > length / 2) d -= length
  if (d < -length / 2) d += length
  return d
}

export function aiInput(sim: Sim, r: SimRacer): Input {
  if (!r.ai || r.finished) return ZERO
  const look = frameAt(sim.track, r.s + Math.max(8, r.v * 0.28))
  const targetX = clamp(-look.curv * 110, -look.width * 0.3, look.width * 0.3) + r.ai.lineBias
  let steer = clamp((targetX - r.x) * 0.42 - r.vx * 0.32 - r.heading * 0.35, -1, 1)
  const wobble = Math.sin(sim.time * 2.2 + r.ai.seed) * 0.04
  steer = clamp(steer + wobble, -1, 1)
  const safe = cornerSafeSpeed(sim.track, r.s, r.stats.gripCoef) * (0.98 + r.ai.aggression * 0.1)
  const brake = r.v > safe ? clamp((r.v - safe) / 7.5, 0, 1) : 0
  const upcoming = Math.abs(look.curv)
  const drift =
    brake < 0.35 &&
    upcoming > 0.018 &&
    r.v > 13 &&
    r.ai.aggression > 0.5 &&
    Math.abs(steer) > 0.22 &&
    r.boost < 0.92
  const straight = upcoming < 0.016
  const boost = r.boost > 0.62 && straight && brake < 0.1
  return { steer, brake, drift, boost }
}

function applyDraft(sim: Sim) {
  const len = sim.track.length
  for (const r of sim.racers) r.draft = 0
  for (const r of sim.racers) {
    if (r.isGhost || r.finished) continue
    for (const o of sim.racers) {
      if (o === r || o.isGhost) continue
      const ds = signedDelta(o.s, r.s, len)
      if (ds > 1.2 && ds < TUNE.draftRange && Math.abs(o.x - r.x) < 2.4) {
        r.draft = Math.max(r.draft, 1 - ds / TUNE.draftRange)
      }
    }
  }
}

function separate(sim: Sim) {
  const len = sim.track.length
  const list = sim.racers.filter((r) => !r.isGhost)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (Math.abs(signedDelta(a.s, b.s, len)) > 3.1) continue
      const minX = a.stats.trackHalf + b.stats.trackHalf + 0.2
      const dx = a.x - b.x
      if (Math.abs(dx) >= minX) continue
      const overlap = minX - Math.abs(dx)
      const dir = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx)
      const ma = 0.55 + a.stats.massN
      const mb = 0.55 + b.stats.massN
      a.x += dir * overlap * (mb / (ma + mb))
      b.x -= dir * overlap * (ma / (ma + mb))
      const ahead = signedDelta(a.s, b.s, len) > 0 ? a : b
      const behind = ahead === a ? b : a
      if (behind.v > ahead.v + 0.4) {
        const dv = (behind.v - ahead.v) * 0.12
        behind.v -= dv
        ahead.v += dv * 0.45
      }
    }
  }
}

function wrapProgress(r: SimRacer, sim: Sim, prevS: number) {
  const length = sim.track.length
  let guard = 0
  while (r.s >= length && guard++ < 4) {
    r.s -= length
    if (!r.crossedOnce) {
      r.crossedOnce = true
      r.lapStart = sim.time
      continue
    }
    const lapT = sim.time - r.lapStart
    r.lastLap = lapT
    if (r.bestLap == null || lapT < r.bestLap) r.bestLap = lapT
    r.lapStart = sim.time
    r.lapsDone++
    if (r.isPlayer) sim.events.push({ type: 'lap', lap: r.lapsDone })
    if (r.lapsDone >= sim.laps && !r.finished) {
      r.finished = true
      r.finishTime = sim.time
      if (r.isPlayer && !r.announcedFinish) {
        r.announcedFinish = true
        sim.events.push({ type: 'finish' })
      }
    }
  }
  if (r.s < 0) r.s = ((r.s % length) + length) % length
  void prevS
}

function stepRacer(sim: Sim, r: SimRacer, dt: number, input: Input) {
  if (r.isGhost && r.ghost && r.ghost.frames.length > 1) {
    const t = sim.time
    const maxT = (r.ghost.frames.length - 1) * r.ghost.dt
    const u = clamp(t / r.ghost.dt, 0, r.ghost.frames.length - 1.001)
    const i0 = Math.floor(u)
    const i1 = i0 + 1
    const f = u - i0
    const a = r.ghost.frames[i0]
    const b = r.ghost.frames[i1]
    const p = a.p + (b.p - a.p) * f
    r.x = a.x + (b.x - a.x) * f
    r.heading = a.h + (b.h - a.h) * f
    let s = p % sim.track.length
    if (s < 0) s += sim.track.length
    r.s = s
    r.v = Math.hypot((b.p - a.p) / r.ghost.dt, 0)
    r.finished = t >= maxT
    r.crossedOnce = p >= 0
    r.lapsDone = Math.max(0, Math.floor(p / sim.track.length))
    return
  }

  const sample = frameAt(sim.track, r.s, 0)
  const steer = clamp(input.steer, -1, 1)
  const braking = input.brake > 0.12 && !r.finished
  const wantDrift =
    !r.finished &&
    r.v > 9 &&
    Math.abs(steer) > 0.12 &&
    (input.drift || (input.brake > 0.55 && Math.abs(steer) > 0.45))
  const wantBoost = !r.finished && input.boost && r.boost > 0.04

  const steerRate = TUNE.headingSteer * (0.82 + r.stats.gripCoef * 0.22)
  if (!r.finished) r.heading += steer * steerRate * dt
  const maxH = wantDrift ? TUNE.maxDriftHeading : TUNE.maxHeading
  r.heading = clamp(r.heading, -maxH, maxH)
  const align = wantDrift ? TUNE.driftAlign : TUNE.align + r.stats.gripCoef * 1.1
  r.heading *= Math.exp(-align * dt)

  let target = r.stats.topSpeed * (r.ai ? 0.94 + r.ai.skill * 0.08 : 1)
  if (wantBoost) target *= TUNE.boostMul
  if (r.draft > 0) target *= 1 + TUNE.draftMul * r.draft
  if (r.ai && sim.rubber) {
    const player = sim.racers.find((o) => o.isPlayer && !o.isGhost)
    if (player) {
      const gap =
        (progressOf(player, sim.track.length) - progressOf(r, sim.track.length)) /
        (sim.track.length * 0.4)
      target *= 1 + clamp(gap, -1, 1) * TUNE.rubber
    }
  }

  if (r.finished) {
    r.v += (8 - r.v) * Math.min(1, dt * 0.8)
  } else if (braking && !wantDrift) {
    r.v -= r.stats.brake * input.brake * dt
  } else if (r.v < target) {
    const closeness = 1 - r.v / target
    r.v += r.stats.accel * (0.32 + 0.68 * closeness) * dt * (braking ? 0.25 : 1)
  } else {
    r.v += (target - r.v) * Math.min(1, dt * 1.4)
  }
  r.v += -sample.slope * TUNE.slopePush * dt
  if (wantBoost) {
    r.v += TUNE.boostKick * dt
    r.boost = Math.max(0, r.boost - TUNE.boostDrain * dt)
    if (!r.boosting && r.isPlayer) sim.events.push({ type: 'boost' })
    r.boosting = true
  } else r.boosting = false

  const maxA = 6.5 + r.stats.gripCoef * 6.2
  const steerCap = wantDrift ? maxA * 1.2 : maxA
  const steerA = clamp(Math.sin(r.heading) * steerCap, -steerCap, steerCap)
  const push = -sample.curv * r.v * r.v * TUNE.centrifugal * (wantDrift ? 1.18 : 1)
  const damp = wantDrift ? 0.75 : 1.85 + r.stats.gripCoef * 0.45
  r.vx += (steerA + push) * dt
  r.vx *= Math.exp(-damp * dt)
  r.v -= Math.abs(r.vx) * TUNE.scrub * (1.05 - r.stats.driftCoef * 0.42) * dt
  r.v = clamp(r.v, 0, r.stats.topSpeed * 1.32)

  const half = sample.width * 0.5 - r.stats.trackHalf
  const prevScraping = r.scraping
  r.x += r.vx * dt
  if (r.x > half) {
    r.x = half
    if (r.vx > 0) r.vx *= -0.15
    r.scraping = true
  } else if (r.x < -half) {
    r.x = -half
    if (r.vx < 0) r.vx *= -0.15
    r.scraping = true
  } else r.scraping = false
  if (r.scraping) {
    r.scrapeTime += dt
    r.v *= 1 - TUNE.wallDrag * dt * (1.05 - r.stats.massN * 0.35)
    if (!prevScraping) {
      r.v *= TUNE.hitSpeed
      r.heading *= 0.55
      if (r.isPlayer) sim.events.push({ type: 'hit' })
    }
  }

  const prevS = r.s
  if (!r.finished) r.s += r.v * Math.cos(r.heading) * dt
  wrapProgress(r, sim, prevS)

  const sliding = Math.abs(r.heading) > 0.26 && Math.abs(r.vx) > 0.7 && r.v > 8
  r.drifting = wantDrift && sliding
  if (r.drifting) {
    r.driftHold += dt
    if (!r.boosting) {
      r.boost = Math.min(
        1,
        r.boost + dt * (TUNE.driftCharge + r.stats.driftCoef * 0.22) * Math.min(1.2, Math.abs(r.heading) / 0.45),
      )
    }
    if (!r.wasDrifting && r.isPlayer) sim.events.push({ type: 'drift' })
  } else if (r.wasDrifting && r.driftHold > 0.32 && !r.finished) {
    r.v = Math.min(r.stats.topSpeed * 1.2, r.v + 1.1 + r.stats.driftCoef * 0.8)
    r.driftHold = 0
  } else r.driftHold = Math.max(0, r.driftHold - dt * 0.5)
  r.wasDrifting = r.drifting

  const pad = frameAt(sim.track, r.s).pad
  if (pad) {
    r.offPad = 0
    if (r.lastPad !== pad) {
      r.lastPad = pad
      r.v = Math.min(r.stats.topSpeed * 1.22, r.v + TUNE.padKick)
      r.boost = Math.min(1, r.boost + TUNE.padBoost)
      if (r.isPlayer) sim.events.push({ type: 'pad' })
    }
  } else {
    r.offPad += r.v * dt
    if (r.offPad > 8) r.lastPad = 0
  }

  const safe = cornerSafeSpeed(sim.track, r.s, r.stats.gripCoef)
  r.hot = !r.drifting && !braking && r.v > safe * 1.08 && Math.abs(sample.curv) > 0.015

  if (!Number.isFinite(r.v)) r.v = 0
  if (!Number.isFinite(r.x)) r.x = 0
  if (!Number.isFinite(r.heading)) r.heading = 0
}

export function stepSim(sim: Sim, dt: number, inputFor: (r: SimRacer) => Input) {
  const h = clamp(dt, 0, 0.05)
  if (!sim.started) {
    sim.countdown -= h
    if (sim.countdown <= 0) {
      sim.started = true
      sim.countdown = 0
      sim.events.push({ type: 'go' })
    }
    return
  }
  sim.time += h
  applyDraft(sim)
  for (const r of sim.racers) {
    const input = r.isGhost ? ZERO : r.ai && !r.isPlayer ? aiInput(sim, r) : inputFor(r)
    stepRacer(sim, r, h, input)
  }
  separate(sim)
  for (const r of sim.racers) {
    if (r.isGhost) continue
    const half = frameAt(sim.track, r.s).width * 0.5 - r.stats.trackHalf
    r.x = clamp(r.x, -half - 0.2, half + 0.2)
  }
}
