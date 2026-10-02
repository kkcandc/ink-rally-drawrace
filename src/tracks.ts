import { clamp, wrapPi } from './format'

export type Vec3 = { x: number; y: number; z: number }

export type Sample = {
  s: number
  x: number
  y: number
  z: number
  tx: number
  ty: number
  tz: number
  rx: number
  ry: number
  rz: number
  ux: number
  uy: number
  uz: number
  width: number
  curv: number
  slope: number
  pad: number
}

export type BuiltTrack = {
  id: string
  name: string
  tagline: string
  length: number
  spacing: number
  samples: Sample[]
}

export type Frame = {
  x: number
  y: number
  z: number
  tx: number
  ty: number
  tz: number
  rx: number
  ry: number
  rz: number
  ux: number
  uy: number
  uz: number
  width: number
  curv: number
  slope: number
  pad: number
}

type Ctrl = { x: number; y: number; z: number }

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

function norm(a: Vec3): Vec3 {
  const l = len(a) || 1
  return scale(a, 1 / l)
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function rodrigues(v: Vec3, axis: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const d = dot(v, axis)
  const cr = cross(axis, v)
  return add(add(scale(v, c), scale(cr, s)), scale(axis, d * (1 - c)))
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

function expand(ctrl: Ctrl[], steps: number): Vec3[] {
  const n = ctrl.length
  const out: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n]
    const p1 = ctrl[i]
    const p2 = ctrl[(i + 1) % n]
    const p3 = ctrl[(i + 2) % n]
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      out.push(
        v3(
          catmull(p0.x, p1.x, p2.x, p3.x, t),
          catmull(p0.y, p1.y, p2.y, p3.y, t),
          catmull(p0.z, p1.z, p2.z, p3.z, t),
        ),
      )
    }
  }
  return out
}

function pointAt(pts: Vec3[], closedDist: number[], total: number, dist: number): Vec3 {
  let d = dist % total
  if (d < 0) d += total
  let i = 0
  while (i < closedDist.length - 1 && closedDist[i + 1] < d) i++
  const a = closedDist[i]
  const b = closedDist[i + 1]
  const t = b === a ? 0 : (d - a) / (b - a)
  const p = pts[i]
  const q = pts[(i + 1) % pts.length]
  return v3(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t)
}

function resample(pts: Vec3[], spacing: number): { pts: Vec3[]; length: number; spacing: number } {
  const cum = [0]
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length]
    cum.push(cum[i] + len({ x: q.x - pts[i].x, y: q.y - pts[i].y, z: q.z - pts[i].z }))
  }
  const total = cum[cum.length - 1]
  const count = Math.max(24, Math.round(total / spacing))
  const step = total / count
  const out: Vec3[] = []
  for (let i = 0; i < count; i++) out.push(pointAt(pts, cum, total, i * step))
  return { pts: out, length: count * step, spacing: step }
}

function bake(id: string, name: string, tagline: string, ctrl: Ctrl[]): BuiltTrack {
  const dense = expand(ctrl, 10)
  const sampled = resample(dense, 2)
  const n = sampled.pts.length
  const step = sampled.spacing
  const raw: Sample[] = []
  let prevRight: Vec3 | null = null
  for (let i = 0; i < n; i++) {
    const prev = sampled.pts[(i - 1 + n) % n]
    const next = sampled.pts[(i + 1) % n]
    const p = sampled.pts[i]
    const tangent = norm(v3(next.x - prev.x, next.y - prev.y, next.z - prev.z))
    let right = cross(v3(0, 1, 0), tangent)
    if (len(right) < 0.2) right = v3(1, 0, 0)
    right = norm(right)
    if (prevRight && dot(right, prevRight) < 0) right = scale(right, -1)
    let up = norm(cross(tangent, right))
    const h0 = Math.atan2(p.x - prev.x, p.z - prev.z)
    const h1 = Math.atan2(next.x - p.x, next.z - p.z)
    const curv = wrapPi(h1 - h0) / step
    const slope = (next.y - prev.y) / (2 * step)
    raw.push({
      s: i * step,
      x: p.x,
      y: p.y,
      z: p.z,
      tx: tangent.x,
      ty: tangent.y,
      tz: tangent.z,
      rx: right.x,
      ry: right.y,
      rz: right.z,
      ux: up.x,
      uy: up.y,
      uz: up.z,
      width: 16,
      curv,
      slope,
      pad: 0,
    })
    prevRight = right
  }
  for (let i = 0; i < n; i++) {
    let c = 0
    for (let k = -2; k <= 2; k++) c += raw[(i + k + n) % n].curv
    raw[i].curv = c / 5
  }
  for (let i = 0; i < n; i++) {
    const s = raw[i]
    const bank = clamp(-s.curv * 7.5, -0.42, 0.42)
    const tangent = v3(s.tx, s.ty, s.tz)
    let right = rodrigues(v3(s.rx, s.ry, s.rz), tangent, bank)
    let up = norm(cross(tangent, right))
    right = norm(right)
    s.rx = right.x
    s.ry = right.y
    s.rz = right.z
    s.ux = up.x
    s.uy = up.y
    s.uz = up.z
    const sharp = clamp((Math.abs(s.curv) - 0.008) / 0.045, 0, 1)
    s.width = 14.5 + sharp * 5.5
  }
  markPads(raw, step)
  return { id, name, tagline, length: sampled.length, spacing: step, samples: raw }
}

function markPads(samples: Sample[], spacing: number) {
  const n = samples.length
  const gap = Math.max(8, Math.round(150 / spacing))
  const padLen = Math.max(6, Math.round(16 / spacing))
  let pad = 1
  for (let cursor = Math.round(18 / spacing); cursor < n - padLen && pad <= 8; cursor += gap) {
    let best = cursor
    let bestScore = Infinity
    const search = Math.round(36 / spacing)
    const from = Math.max(0, cursor - search)
    const to = Math.min(n - padLen, cursor + search)
    for (let i = from; i < to; i++) {
      let score = 0
      let blocked = false
      for (let k = 0; k < padLen; k++) {
        if (samples[i + k].pad) blocked = true
        score += Math.abs(samples[i + k].curv)
      }
      if (!blocked && score < bestScore) {
        bestScore = score
        best = i
      }
    }
    if (!Number.isFinite(bestScore)) continue
    for (let k = 0; k < padLen; k++) samples[best + k].pad = pad
    pad++
  }
}

function loop(opts: {
  rx: number
  rz: number
  yAmp: number
  harmonics: { k: number; ax: number; az: number; ph: number }[]
}): Ctrl[] {
  const n = 20
  const pts: Ctrl[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    let x = Math.cos(t) * opts.rx
    let z = Math.sin(t) * opts.rz
    let y = Math.sin(t * 2) * opts.yAmp + Math.sin(t) * opts.yAmp * 0.35
    for (const h of opts.harmonics) {
      x += Math.cos(t * h.k + h.ph) * h.ax
      z += Math.sin(t * h.k + h.ph * 0.7) * h.az
      y += Math.sin(t * h.k + h.ph) * Math.min(2.2, Math.abs(h.ax) * 0.04)
    }
    pts.push({ x, y, z })
  }
  return pts
}

export const TRACKS: BuiltTrack[] = [
  bake(
    'quill',
    'Quill Circuit',
    'A wide first page. Learn the ink before it learns you.',
    loop({
      rx: 168,
      rz: 102,
      yAmp: 4.5,
      harmonics: [{ k: 3, ax: 16, az: 8, ph: 0.4 }],
    }),
  ),
  bake(
    'blotter',
    'Blotter Bend',
    'The corners blot. Drift, or wear the curb.',
    loop({
      rx: 142,
      rz: 118,
      yAmp: 2.4,
      harmonics: [
        { k: 2, ax: 34, az: 12, ph: 0.35 },
        { k: 3, ax: 8, az: 20, ph: 1.1 },
      ],
    }),
  ),
  bake(
    'margin',
    'Margin Marathon',
    'Long paper, tall hills, boosts like dropped punctuation.',
    loop({
      rx: 228,
      rz: 146,
      yAmp: 9,
      harmonics: [{ k: 2, ax: 22, az: 10, ph: 0.7 }],
    }),
  ),
]

const BY_ID = new Map(TRACKS.map((t) => [t.id, t]))

export function getTrack(id: string): BuiltTrack {
  return BY_ID.get(id) ?? TRACKS[0]
}

export function frameAt(track: BuiltTrack, s: number, lateral = 0): Frame {
  const n = track.samples.length
  let ss = s % track.length
  if (ss < 0) ss += track.length
  const f = ss / track.spacing
  const i0 = Math.floor(f) % n
  const i1 = (i0 + 1) % n
  const t = f - Math.floor(f)
  const a = track.samples[i0]
  const b = track.samples[i1]
  const mix = (p: number, q: number) => p + (q - p) * t
  let tx = mix(a.tx, b.tx)
  let ty = mix(a.ty, b.ty)
  let tz = mix(a.tz, b.tz)
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl
  ty /= tl
  tz /= tl
  let rx = mix(a.rx, b.rx)
  let ry = mix(a.ry, b.ry)
  let rz = mix(a.rz, b.rz)
  const rl = Math.hypot(rx, ry, rz) || 1
  rx /= rl
  ry /= rl
  rz /= rl
  let ux = ty * rz - tz * ry
  let uy = tz * rx - tx * rz
  let uz = tx * ry - ty * rx
  const ul = Math.hypot(ux, uy, uz) || 1
  ux /= ul
  uy /= ul
  uz /= ul
  const width = mix(a.width, b.width)
  const x = mix(a.x, b.x) + rx * lateral
  const y = mix(a.y, b.y) + ry * lateral
  const z = mix(a.z, b.z) + rz * lateral
  return {
    x,
    y,
    z,
    tx,
    ty,
    tz,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
    width,
    curv: mix(a.curv, b.curv),
    slope: mix(a.slope, b.slope),
    pad: a.pad || b.pad,
  }
}

export function trackCrosses(track: BuiltTrack): boolean {
  const pts = track.samples
  const n = pts.length
  const orient = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
    (bz - az) * (cx - bx) - (bx - ax) * (cz - bz)
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      const gap = Math.min(Math.abs(i - j), n - Math.abs(i - j))
      if (gap < 3) continue
      if (i === 0 && j >= n - 2) continue
      const c = pts[j]
      const d = pts[(j + 1) % n]
      const o1 = orient(a.x, a.z, b.x, b.z, c.x, c.z)
      const o2 = orient(a.x, a.z, b.x, b.z, d.x, d.z)
      const o3 = orient(c.x, c.z, d.x, d.z, a.x, a.z)
      const o4 = orient(c.x, c.z, d.x, d.z, b.x, b.z)
      if (o1 * o2 < 0 && o3 * o4 < 0) return true
    }
  }
  return false
}

export function trackSvg(track: BuiltTrack, w = 240, h = 132): string {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const s of track.samples) {
    if (s.x < minX) minX = s.x
    if (s.x > maxX) maxX = s.x
    if (s.z < minZ) minZ = s.z
    if (s.z > maxZ) maxZ = s.z
  }
  const pad = 10
  const sx = (maxX - minX) || 1
  const sz = (maxZ - minZ) || 1
  const pts: string[] = []
  for (let i = 0; i < track.samples.length; i += 2) {
    const s = track.samples[i]
    const x = pad + ((s.x - minX) / sx) * (w - pad * 2)
    const y = pad + ((s.z - minZ) / sz) * (h - pad * 2)
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  const s0 = track.samples[0]
  pts.push(
    `${(pad + ((s0.x - minX) / sx) * (w - pad * 2)).toFixed(1)},${(pad + ((s0.z - minZ) / sz) * (h - pad * 2)).toFixed(1)}`,
  )
  return `<svg viewBox="0 0 ${w} ${h}" class="track-svg" aria-hidden="true"><polyline points="${pts.join(' ')}" /></svg>`
}

export function rightContinuity(track: BuiltTrack): number {
  let worst = 1
  const n = track.samples.length
  for (let i = 0; i < n; i++) {
    const a = track.samples[i]
    const b = track.samples[(i + 1) % n]
    const d = a.rx * b.rx + a.ry * b.ry + a.rz * b.rz
    if (d < worst) worst = d
  }
  return worst
}
