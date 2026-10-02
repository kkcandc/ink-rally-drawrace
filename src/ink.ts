import { clamp, djb2, lerp, mulberry32 } from './format'

export const MASK_W = 128
export const MASK_H = 72

export const INKS = [
  { id: 'sumi', hex: '#1c1915', name: 'Sumi' },
  { id: 'vermillion', hex: '#ef4b32', name: 'Vermillion' },
  { id: 'sea', hex: '#147a86', name: 'Sea' },
  { id: 'indigo', hex: '#2c3ec8', name: 'Indigo' },
  { id: 'leaf', hex: '#2c7a3c', name: 'Leaf' },
  { id: 'gold', hex: '#c9841a', name: 'Gold' },
  { id: 'magenta', hex: '#d43378', name: 'Magenta' },
  { id: 'violet', hex: '#6d3cba', name: 'Violet' },
] as const

export type InkMask = {
  w: number
  h: number
  bits: Uint8Array
  color: string
}

export type RuntimeStats = {
  raceable: boolean
  reason: string
  speed: number
  thrust: number
  grip: number
  drift: number
  mass: number
  topSpeed: number
  accel: number
  brake: number
  gripCoef: number
  driftCoef: number
  trackHalf: number
  length: number
  height: number
  massN: number
  quirk: string
  read: string
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
}

export type AiProfile = {
  skill: number
  aggression: number
  lineBias: number
  seed: number
}

export type Rival = {
  id: string
  name: string
  color: string
  blurb: string
  mask: InkMask
  ai: AiProfile
}

const LEFT = ['Needle', 'Blot', 'Quill', 'Puddle', 'Folio', 'Margin', 'Carbon', 'Wet', 'Loose', 'Gallery', 'Iron', 'Drip']
const RIGHT = ['Newt', 'Bison', 'Mantis', 'Pug', 'Heron', 'Imp', 'Ox', 'Eel', 'Crab', 'Wren', 'Toad', 'Moth']

export function suggestName(mask: InkMask): string {
  const h = djb2(bitsKey(mask))
  return `${LEFT[h % LEFT.length]} ${RIGHT[(h >>> 8) % RIGHT.length]}`
}

function bitsKey(mask: InkMask): string {
  let s = ''
  for (let i = 0; i < mask.bits.length; i += 17) s += mask.bits[i] ? '1' : '0'
  return s + mask.color
}

export function analyze(mask: InkMask): RuntimeStats {
  const { w, h, bits } = mask
  let count = 0
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let sumY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bits[y * w + x]) continue
      count++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      sumY += y
    }
  }
  const bbox = {
    minX: Math.max(0, minX),
    minY: Math.max(0, minY),
    maxX: Math.max(0, maxX),
    maxY: Math.max(0, maxY),
  }
  if (count < 20 || maxX < minX || maxY < minY) {
    return neutral(bbox, 'Too faint — lay down a real silhouette.')
  }
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  if (bw < 10 || bh < 6) return neutral(bbox, 'Give it a body, not a speck.')

  const aspect = bw / bh
  const long = clamp((aspect - 0.85) / 3.4, 0, 1)
  const massN = clamp(count / (w * h) / 0.2, 0, 1)
  const tall = clamp(bh / h / 0.72, 0, 1)

  let perim = 0
  const colSpan = new Float64Array(w)
  const colBot = new Uint8Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bits[y * w + x]) continue
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !bits[y * w + x - 1] ||
        !bits[y * w + x + 1] ||
        !bits[(y - 1) * w + x] ||
        !bits[(y + 1) * w + x]
      if (edge) perim++
      const top = colSpan[x] === 0 ? y : Math.min(colTop(bits, w, x, y), y)
      void top
    }
  }
  const tops = new Int16Array(w)
  const bots = new Int16Array(w)
  tops.fill(-1)
  bots.fill(-1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bits[y * w + x]) continue
      if (tops[x] < 0) tops[x] = y
      bots[x] = y
    }
  }
  let spanSum = 0
  let spanN = 0
  for (let x = minX; x <= maxX; x++) {
    if (tops[x] >= 0) {
      colSpan[x] = bots[x] - tops[x] + 1
      spanSum += colSpan[x]
      spanN++
    }
  }
  const bottomBand = minY + bh * 0.82
  let botCols = 0
  for (let x = minX; x <= maxX; x++) {
    for (let y = Math.floor(bottomBand); y <= maxY; y++) {
      if (bits[y * w + x]) {
        colBot[x] = 1
        break
      }
    }
    if (colBot[x]) botCols++
  }
  const stance = botCols / bw
  const meanY = sumY / count
  const cyB = clamp((meanY - minY) / bh, 0, 1)
  const topHeavy = clamp((0.5 - cyB) / 0.34, 0, 1)
  const jagged = clamp(perim / (2 * (bw + bh) + 8) - 0.85, 0, 1)

  const frontX0 = minX + Math.floor(bw * 0.78)
  const midX0 = minX + Math.floor(bw * 0.35)
  const midX1 = minX + Math.floor(bw * 0.62)
  const frontExtent = avgSpan(colSpan, frontX0, maxX)
  const midExtent = avgSpan(colSpan, midX0, midX1)
  const taper = clamp((midExtent - frontExtent) / (midExtent + 0.001), 0, 1)

  const speedF = clamp(long * 0.64 + (1 - massN) * 0.22 + taper * 0.14, 0, 1)
  const thrustF = clamp((1 - massN) * 0.62 + (1 - long) * 0.22 + (1 - topHeavy) * 0.16, 0, 1)
  const gripF = clamp(stance * 0.42 + (1 - long) * 0.28 + (1 - topHeavy) * 0.18 + (1 - jagged) * 0.12, 0, 1)
  const driftF = clamp(jagged * 0.38 + (1 - stance) * 0.28 + long * 0.18 + topHeavy * 0.16, 0, 1)

  const topSpeed = lerp(20.4, 29.2, speedF)
  const accel = lerp(11.5, 24.5, thrustF)
  const gripCoef = lerp(0.62, 1.42, gripF)
  const driftCoef = lerp(0.32, 1.28, driftF)
  const brake = lerp(15, 23, gripF)
  const length = lerp(1.75, 3.85, clamp((bw / w) * 1.25, 0, 1))
  const height = lerp(0.82, 2.35, clamp((bh / h) * 1.15, 0, 1))
  const trackHalf = lerp(0.82, 1.48, clamp(massN * 0.62 + tall * 0.38, 0, 1))

  const scores = [
    { k: 'speed', v: speedF, quirk: 'Needle lung — built for the straight.' },
    { k: 'grip', v: gripF, quirk: 'Stamp press — planted when the paper bends.' },
    { k: 'drift', v: driftF, quirk: 'Wet nib — it slides and keeps the line.' },
    { k: 'mass', v: massN, quirk: 'Inkstone — slow to wake, rude to shove.' },
  ]
  scores.sort((a, b) => b.v - a.v)
  let quirk = scores[0].v > 0.58 ? scores[0].quirk : 'House blend — honest ink, no tricks.'
  if (topHeavy > 0.72 && scores[0].k !== 'drift') quirk = 'Top-heavy serif — tall ink, light feet.'

  const read = [
    long > 0.66 ? 'Long' : long < 0.34 ? 'Stubby' : 'Middling',
    massN > 0.62 ? 'heavy' : massN < 0.35 ? 'light' : 'medium',
    taper > 0.45 ? 'pointy nose' : taper < 0.18 ? 'blunt nose' : 'soft nose',
    stance > 0.72 ? 'flat belly' : 'tiptoe feet',
  ].join(' · ')

  void spanN
  void spanSum

  return {
    raceable: true,
    reason: '',
    speed: Math.round(speedF * 100),
    thrust: Math.round(thrustF * 100),
    grip: Math.round(gripF * 100),
    drift: Math.round(driftF * 100),
    mass: Math.round(massN * 100),
    topSpeed,
    accel,
    brake,
    gripCoef,
    driftCoef,
    trackHalf,
    length,
    height,
    massN,
    quirk,
    read,
    bbox,
  }
}

function colTop(bits: Uint8Array, w: number, x: number, y: number): number {
  void bits
  void w
  void x
  return y
}

function avgSpan(span: Float64Array, x0: number, x1: number): number {
  let s = 0
  let n = 0
  const a = Math.max(0, x0)
  const b = Math.min(span.length - 1, x1)
  for (let x = a; x <= b; x++) {
    if (span[x] > 0) {
      s += span[x]
      n++
    }
  }
  return n ? s / n : 0
}

function neutral(bbox: RuntimeStats['bbox'], reason: string): RuntimeStats {
  return {
    raceable: false,
    reason,
    speed: 0,
    thrust: 0,
    grip: 0,
    drift: 0,
    mass: 0,
    topSpeed: 18,
    accel: 10,
    brake: 14,
    gripCoef: 0.7,
    driftCoef: 0.4,
    trackHalf: 1,
    length: 2,
    height: 1,
    massN: 0.3,
    quirk: reason,
    read: 'Unreadable',
    bbox,
  }
}

function b64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function unb64(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function packBits(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8))
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7)
  return out
}

function unpackBits(packed: Uint8Array, count: number): Uint8Array | null {
  if (packed.length < Math.ceil(count / 8)) return null
  const bits = new Uint8Array(count)
  for (let i = 0; i < count; i++) bits[i] = (packed[i >> 3] >> (i & 7)) & 1
  return bits
}

function rleBits(bits: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < bits.length) {
    const v = bits[i] & 1
    let n = 0
    while (i < bits.length && (bits[i] & 1) === v && n < 65535) {
      n++
      i++
    }
    out.push(v, n >> 8, n & 255)
  }
  return Uint8Array.from(out)
}

function unrle(data: Uint8Array, count: number): Uint8Array | null {
  const bits = new Uint8Array(count)
  let o = 0
  let p = 0
  while (p + 2 < data.length && o < count) {
    const v = data[p] & 1
    const n = (data[p + 1] << 8) | data[p + 2]
    p += 3
    if (n <= 0 || o + n > count) return null
    if (v) bits.fill(1, o, o + n)
    o += n
  }
  if (o !== count) return null
  return bits
}

export function encodeMask(mask: InkMask): string {
  const color = Math.max(
    0,
    INKS.findIndex((c) => c.hex.toLowerCase() === mask.color.toLowerCase()),
  )
  const raw = packBits(mask.bits)
  const rle = rleBits(mask.bits)
  const useRle = rle.length < raw.length
  const body = useRle ? rle : raw
  const payload = new Uint8Array(4 + body.length)
  payload[0] = 1
  payload[1] = (useRle ? 1 : 0) | (color << 1)
  payload[2] = mask.w
  payload[3] = mask.h
  payload.set(body, 4)
  return `INK1.${b64(payload)}`
}

export function extractCode(input: string): string {
  const trimmed = input.trim()
  const fromQuery = trimmed.match(/[?&]ink=([^&\s]+)/i)
  if (fromQuery) {
    try {
      return decodeURIComponent(fromQuery[1])
    } catch {
      return fromQuery[1]
    }
  }
  const bare = trimmed.match(/INK1\.[A-Za-z0-9\-_]+/i)
  return bare ? bare[0] : trimmed.replace(/\s+/g, '')
}

export function decodeMask(input: string): InkMask | null {
  const code = extractCode(input)
  const body = code.replace(/^INK1\./i, '')
  const payload = unb64(body)
  if (!payload || payload.length < 5 || payload[0] !== 1) return null
  const useRle = (payload[1] & 1) === 1
  const colorIdx = (payload[1] >> 1) & 7
  const w = payload[2]
  const h = payload[3]
  if (w !== MASK_W || h !== MASK_H) return null
  const data = payload.subarray(4)
  const bits = useRle ? unrle(data, w * h) : unpackBits(data, w * h)
  if (!bits) return null
  return { w, h, bits, color: INKS[colorIdx]?.hex ?? INKS[0].hex }
}

export function countInk(mask: InkMask): number {
  let n = 0
  for (let i = 0; i < mask.bits.length; i++) if (mask.bits[i]) n++
  return n
}

function stamp(bits: Uint8Array, w: number, h: number, x: number, y: number, r: number) {
  const r2 = r * r
  const x0 = Math.max(0, Math.floor(x - r))
  const x1 = Math.min(w - 1, Math.ceil(x + r))
  const y0 = Math.max(0, Math.floor(y - r))
  const y1 = Math.min(h - 1, Math.ceil(y + r))
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + 0.5 - x
      const dy = yy + 0.5 - y
      if (dx * dx + dy * dy <= r2) bits[yy * w + xx] = 1
    }
  }
}

function stroke(
  bits: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const n = Math.max(1, Math.ceil(len / Math.max(0.4, r * 0.35)))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    stamp(bits, w, h, x0 + dx * t, y0 + dy * t, r)
  }
}

function blank(color: string): Uint8Array {
  return new Uint8Array(MASK_W * MASK_H)
  void color
}

function maskOf(bits: Uint8Array, color: string): InkMask {
  return { w: MASK_W, h: MASK_H, bits, color }
}

function drawNewt(bits: Uint8Array) {
  const w = MASK_W
  const h = MASK_H
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    const x = 8 + t * 112
    const y = 50 + Math.sin(t * Math.PI) * -4
    const r = t < 0.12 ? 2.2 + t * 10 : t > 0.86 ? 3.2 : 5.5 + Math.sin(t * Math.PI) * 2.2
    stamp(bits, w, h, x, y, r)
  }
  stroke(bits, w, h, 18, 52, 16, 64, 1.6)
  stroke(bits, w, h, 40, 54, 38, 66, 1.7)
  stroke(bits, w, h, 70, 54, 72, 66, 1.7)
  stroke(bits, w, h, 96, 52, 100, 64, 1.5)
  stamp(bits, w, h, 112, 46, 2.1)
}

function drawBison(bits: Uint8Array) {
  const w = MASK_W
  const h = MASK_H
  for (let i = 0; i <= 22; i++) {
    const t = i / 22
    const x = 18 + t * 78
    const y = 42
    stamp(bits, w, h, x, y, 16 - Math.abs(t - 0.45) * 6)
  }
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    stamp(bits, w, h, 96 + t * 22, 40 + Math.sin(t * 2) * 2, 9 - t * 2)
  }
  stroke(bits, w, h, 108, 34, 122, 16, 2.4)
  stroke(bits, w, h, 116, 20, 124, 22, 2)
  stroke(bits, w, h, 28, 54, 24, 68, 3.4)
  stroke(bits, w, h, 48, 56, 46, 68, 3.6)
  stroke(bits, w, h, 70, 56, 74, 68, 3.4)
  stroke(bits, w, h, 92, 54, 98, 67, 3.2)
  stamp(bits, w, h, 112, 40, 1.6)
}

function drawMantis(bits: Uint8Array) {
  const w = MASK_W
  const h = MASK_H
  stroke(bits, w, h, 16, 36, 108, 30, 3.1)
  stamp(bits, w, h, 112, 28, 5)
  stroke(bits, w, h, 100, 26, 124, 8, 2.2)
  stroke(bits, w, h, 118, 12, 126, 18, 1.8)
  stroke(bits, w, h, 30, 36, 18, 66, 1.5)
  stroke(bits, w, h, 48, 34, 40, 67, 1.45)
  stroke(bits, w, h, 66, 32, 72, 66, 1.4)
  stroke(bits, w, h, 84, 31, 96, 64, 1.45)
  stroke(bits, w, h, 70, 28, 92, 10, 2.3)
  stroke(bits, w, h, 88, 14, 104, 22, 1.8)
}

function drawPug(bits: Uint8Array) {
  const w = MASK_W
  const h = MASK_H
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    stamp(bits, w, h, 28 + t * 60, 44, 14)
  }
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    stamp(bits, w, h, 86 + t * 28, 46 - t * 4, 11 - t)
  }
  stamp(bits, w, h, 118, 40, 3)
  stroke(bits, w, h, 40, 56, 36, 68, 3.2)
  stroke(bits, w, h, 62, 56, 64, 68, 3.3)
  stroke(bits, w, h, 84, 54, 90, 67, 2.8)
  stroke(bits, w, h, 20, 40, 8, 28, 2.2)
}

function drawSaint(bits: Uint8Array) {
  const w = MASK_W
  const h = MASK_H
  stroke(bits, w, h, 78, 64, 78, 18, 3.2)
  for (let a = 0; a <= 18; a++) {
    const t = a / 18
    const ang = Math.PI * (1.15 + t * 0.7)
    stamp(bits, w, h, 78 + Math.cos(ang) * 16, 16 + Math.sin(ang) * 10, 1.7)
  }
  stroke(bits, w, h, 78, 30, 108, 26, 2.2)
  stroke(bits, w, h, 104, 26, 122, 18, 1.6)
  stroke(bits, w, h, 70, 64, 58, 70, 2)
  stroke(bits, w, h, 86, 64, 98, 70, 2)
  stroke(bits, w, h, 78, 24, 48, 48, 1.7)
}

function drawMoth(bits: Uint8Array) {
  const w = MASK_W
  const h = MASK_H
  stroke(bits, w, h, 20, 40, 110, 36, 3)
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    const x = 40 + t * 40
    const y = 28 - Math.sin(t * Math.PI) * 18
    stamp(bits, w, h, x, y, 2.4)
    stamp(bits, w, h, x, 52 + Math.sin(t * Math.PI) * 14, 2.4)
  }
  stroke(bits, w, h, 108, 36, 124, 30, 2)
}

export const RIVALS: Rival[] = [
  {
    id: 'newt',
    name: 'Needle Newt',
    color: INKS[2].hex,
    blurb: 'A long wet line. Hates corners, loves the margin.',
    mask: maskOf(fill(drawNewt), INKS[2].hex),
    ai: { skill: 0.96, aggression: 0.78, lineBias: -0.4, seed: 3 },
  },
  {
    id: 'bison',
    name: 'Blot Bison',
    color: INKS[5].hex,
    blurb: 'Heavy stamp. Once it is rolling, the curb moves.',
    mask: maskOf(fill(drawBison), INKS[5].hex),
    ai: { skill: 0.9, aggression: 0.42, lineBias: 0.8, seed: 9 },
  },
  {
    id: 'mantis',
    name: 'Quill Mantis',
    color: INKS[1].hex,
    blurb: 'All elbows. Drifts because the feet barely agree.',
    mask: maskOf(fill(drawMantis), INKS[1].hex),
    ai: { skill: 0.94, aggression: 0.88, lineBias: 0.2, seed: 15 },
  },
  {
    id: 'pug',
    name: 'Puddle Pug',
    color: INKS[6].hex,
    blurb: 'Round, rude, and quicker off the blot than it looks.',
    mask: maskOf(fill(drawPug), INKS[6].hex),
    ai: { skill: 0.86, aggression: 0.55, lineBias: -1.1, seed: 21 },
  },
  {
    id: 'saint',
    name: 'Splinter Saint',
    color: INKS[7].hex,
    blurb: 'Tall as a drop cap. Top-heavy and theatrical.',
    mask: maskOf(fill(drawSaint), INKS[7].hex),
    ai: { skill: 0.88, aggression: 0.7, lineBias: 1.3, seed: 27 },
  },
]

export const LOANER_MOTH: Rival = {
  id: 'moth',
  name: 'Margin Moth',
  color: INKS[3].hex,
  blurb: 'Wings for days. A loaner if your page is still blank.',
  mask: maskOf(fill(drawMoth), INKS[3].hex),
  ai: { skill: 0.8, aggression: 0.5, lineBias: 0, seed: 4 },
}

function fill(draw: (bits: Uint8Array) => void): Uint8Array {
  const bits = blank('#000')
  draw(bits)
  return bits
}

export function scribble(seed: number, color: string): InkMask {
  const rng = mulberry32(seed || 1)
  const bits = new Uint8Array(MASK_W * MASK_H)
  const yBase = 36 + rng() * 14
  const x0 = 8 + rng() * 8
  const span = 78 + rng() * 36
  const thick = 3.2 + rng() * 5.5
  const waves = 1 + Math.floor(rng() * 3)
  const amp = 2 + rng() * 7
  const steps = 28
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x0 + t * span
    const y = yBase + Math.sin(t * Math.PI * waves) * amp
    const nose = t > 0.82 ? 0.55 + (1 - t) * 2 : 1
    const r = thick * (0.45 + Math.sin(t * Math.PI) * 0.7) * nose
    stamp(bits, MASK_W, MASK_H, x, y, r)
  }
  const legs = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < legs; i++) {
    const t = 0.18 + (i / legs) * 0.6
    const x = x0 + t * span
    const y = yBase + Math.sin(t * Math.PI * waves) * amp + thick * 0.4
    const foot = 62 + rng() * 8
    stroke(bits, MASK_W, MASK_H, x, y, x + (rng() - 0.5) * 10, foot, 1.3 + rng())
  }
  if (rng() > 0.45) {
    const hx = x0 + span * 0.92
    const hy = yBase - thick
    stroke(bits, MASK_W, MASK_H, hx, hy, hx + 10 + rng() * 8, hy - 8 - rng() * 12, 1.8)
  }
  if (rng() > 0.55) {
    const wx = x0 + span * 0.45
    stroke(bits, MASK_W, MASK_H, wx, yBase - thick, wx + 16, yBase - 16 - rng() * 10, 2)
  }
  stamp(bits, MASK_W, MASK_H, x0 + span * 0.9, yBase - 1, 1.5)
  return { w: MASK_W, h: MASK_H, bits, color }
}

export function renderMaskCanvas(mask: InkMask, width = 960): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const aspect = mask.w / mask.h
  c.width = width
  c.height = Math.max(1, Math.round(width / aspect))
  const g = c.getContext('2d')
  if (!g) return c
  g.clearRect(0, 0, c.width, c.height)
  const sx = c.width / mask.w
  const sy = c.height / mask.h
  g.fillStyle = mask.color
  const r = Math.max(sx, sy) * 0.78
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.bits[y * mask.w + x]) continue
      g.beginPath()
      g.arc((x + 0.5) * sx, (y + 0.5) * sy, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

export function paintMask(ctx: CanvasRenderingContext2D, mask: InkMask, dw: number, dh: number) {
  ctx.clearRect(0, 0, dw, dh)
  ctx.fillStyle = mask.color
  const sx = dw / mask.w
  const sy = dh / mask.h
  const r = Math.max(sx, sy) * 0.72
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.bits[y * mask.w + x]) continue
      ctx.beginPath()
      ctx.arc((x + 0.5) * sx, (y + 0.5) * sy, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Sample a transparent ink canvas into the rally mask. Right side is the nose. */
export function canvasToMask(source: HTMLCanvasElement, color: string): InkMask {
  const c = document.createElement('canvas')
  c.width = MASK_W
  c.height = MASK_H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  const bits = new Uint8Array(MASK_W * MASK_H)
  if (!ctx) return { w: MASK_W, h: MASK_H, bits, color }
  ctx.drawImage(source, 0, 0, MASK_W, MASK_H)
  const data = ctx.getImageData(0, 0, MASK_W, MASK_H).data
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3] > 40 ? 1 : 0
  return { w: MASK_W, h: MASK_H, bits, color }
}
