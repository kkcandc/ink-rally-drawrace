import { clamp, djb2 } from './format'
import type { GhostFrame } from './sim'

const KEY = 'ink-rally-v1'

export type GalleryItem = {
  id: string
  name: string
  code: string
  created: number
  races: number
  wins: number
  cups: number
  bests: Record<string, { race: number; lap: number }>
  thumb: string
}

export type GhostSave = {
  key: string
  race: number
  lap: number
  b64: string
  saved: number
}

export type CupEntry = { key: string; name: string; pts: number; you: boolean }

export type CupSave = {
  round: number
  name: string
  code: string
  points: CupEntry[]
}

export type Settings = { sound: boolean; coached: boolean }

type Save = {
  gallery: GalleryItem[]
  ghosts: GhostSave[]
  cup: CupSave | null
  settings: Settings
}

function empty(): Save {
  return { gallery: [], ghosts: [], cup: null, settings: { sound: true, coached: false } }
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<Save>
    return {
      gallery: Array.isArray(parsed.gallery) ? parsed.gallery : [],
      ghosts: Array.isArray(parsed.ghosts) ? parsed.ghosts : [],
      cup: parsed.cup ?? null,
      settings: {
        sound: parsed.settings?.sound !== false,
        coached: !!parsed.settings?.coached,
      },
    }
  } catch {
    return empty()
  }
}

export function writeSave(save: Save) {
  const dump = () => localStorage.setItem(KEY, JSON.stringify(save))
  try {
    dump()
  } catch {
    save.gallery = save.gallery.map((g) => ({ ...g, thumb: '' }))
    try {
      dump()
    } catch {
      /* private mode or full disk — the session still runs */
    }
  }
}

export function upsertGallery(save: Save, item: GalleryItem): GalleryItem {
  const i = save.gallery.findIndex((g) => g.id === item.id || g.code === item.code)
  if (i >= 0) {
    const prev = save.gallery[i]
    const bests = { ...prev.bests }
    for (const [k, v] of Object.entries(item.bests)) {
      const old = bests[k]
      if (!old || v.race < old.race) bests[k] = v
      else if (v.lap < old.lap) bests[k] = { race: old.race, lap: v.lap }
    }
    const next: GalleryItem = {
      ...prev,
      name: item.name || prev.name,
      races: prev.races + item.races,
      wins: prev.wins + item.wins,
      cups: prev.cups + item.cups,
      bests,
      thumb: item.thumb || prev.thumb,
    }
    save.gallery[i] = next
    writeSave(save)
    return next
  }
  save.gallery.unshift(item)
  save.gallery = save.gallery.slice(0, 24)
  writeSave(save)
  return item
}

export function removeGallery(save: Save, id: string) {
  save.gallery = save.gallery.filter((g) => g.id !== id)
  writeSave(save)
}

export function ghostKey(trackId: string, laps: number, code: string): string {
  return `${trackId}:${laps}:${djb2(code).toString(36)}`
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

export function packGhost(frames: GhostFrame[], length: number): string {
  const buf = new Uint8Array(frames.length * 6)
  const view = new DataView(buf.buffer)
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    view.setInt16(i * 6, Math.round(clamp(f.p / length, -1.2, 14) * 2000))
    view.setInt16(i * 6 + 2, Math.round(clamp(f.x, -24, 24) * 400))
    view.setInt16(i * 6 + 4, Math.round(clamp(f.h, -2, 2) * 8000))
  }
  return b64(buf)
}

export function unpackGhost(b64s: string, length: number): GhostFrame[] {
  const buf = unb64(b64s)
  if (!buf || buf.length < 12) return []
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const frames: GhostFrame[] = []
  for (let i = 0; i + 6 <= buf.length; i += 6) {
    frames.push({
      p: (view.getInt16(i) / 2000) * length,
      x: view.getInt16(i + 2) / 400,
      h: view.getInt16(i + 4) / 8000,
    })
  }
  return frames
}

export function saveGhost(save: Save, key: string, race: number, lap: number, frames: GhostFrame[], length: number) {
  if (frames.length < 8) return
  const next: GhostSave = { key, race, lap, b64: packGhost(frames, length), saved: Date.now() }
  save.ghosts = [next, ...save.ghosts.filter((g) => g.key !== key)].slice(0, 8)
  writeSave(save)
}

export function findGhost(save: Save, key: string): GhostSave | null {
  return save.ghosts.find((g) => g.key === key) ?? null
}
