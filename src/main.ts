import { AudioBus } from './audio'
import { DrawPad } from './draw'
import { clamp, esc, formatTime, ordinal } from './format'
import {
  analyze,
  canvasToMask,
  decodeMask,
  encodeMask,
  extractCode,
  INKS,
  LOANER_MOTH,
  paintMask,
  renderMaskCanvas,
  RIVALS,
  scribble,
  suggestName,
  type InkMask,
  type RuntimeStats,
} from './ink'
import { Portrait } from './portrait'
import './style.css'
import { RaceView, type HudSnap } from './race'
import { createRace, standings, type Input, type RacerSpec, type Sim, type SimEvent } from './sim'
import {
  findGhost,
  ghostKey,
  loadSave,
  removeGallery,
  saveGhost,
  unpackGhost,
  upsertGallery,
  writeSave,
  type CupSave,
  type GalleryItem,
} from './storage'
import { getTrack, TRACKS, trackSvg, type BuiltTrack } from './tracks'

type Art = {
  id: string
  name: string
  mask: InkMask
  sprite: HTMLCanvasElement
  stats: RuntimeStats
  code: string
}

type Screen = 'title' | 'draw' | 'studio' | 'race' | 'results' | 'gallery'

type ResultRow = { name: string; you: boolean; time: number | null; place: number }

type RaceResult = {
  place: number
  field: number
  time: number
  bestLap: number | null
  trackId: string
  trackName: string
  laps: number
  rows: ResultRow[]
  ghostRace: number | null
  beatGhost: boolean | null
  points: number
}

const CUP_TRACKS = ['quill', 'blotter', 'margin']
const POINTS = [10, 7, 5, 3, 2, 1]

const ui = document.querySelector<HTMLElement>('#ui')!
const gl = document.querySelector<HTMLCanvasElement>('#gl')!
const audio = new AudioBus()
const pad = new DrawPad()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

let save = loadSave()
let screen: Screen = 'title'
let art: Art | null = null
let trackId = 'quill'
let laps = 3
let field: 0 | 3 | 5 = 3
let cup: CupSave | null = save.cup
let attract: RaceView | null = null
let race: RaceView | null = null
let portrait: Portrait | null = null
let result: RaceResult | null = null
let ended = false
let lastCount = 4
let steerSmooth = 0
let bannerTimer = 0
const keys = new Set<string>()

audio.setMuted(!save.settings.sound)
pad.onNote = (s) => toast(s)
pad.setOnChange(() => {
  if (screen === 'draw') refreshTicket()
})

document.addEventListener('pointerdown', () => audio.unlock(), { passive: true })

window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  if (!typing) keys.add(e.key.toLowerCase())
  if (screen === 'race' && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
    e.preventDefault()
  }
  if (!typing && e.key === 'Escape' && screen === 'race') togglePause()
  if (!typing && (e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && screen === 'draw') {
    e.preventDefault()
    pad.undoStroke()
  }
  if (!typing && screen === 'draw' && !e.metaKey && !e.ctrlKey) {
    if (e.key === '1') pad.tool = 'pen'
    if (e.key === '2') pad.tool = 'erase'
    if (e.key === '3') pad.tool = 'fill'
    markTools()
  }
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

boot()

function boot() {
  const incoming = new URLSearchParams(location.search).get('ink')
  if (incoming) {
    const mask = decodeMask(incoming)
    if (mask) {
      openStudio(artFromMask(suggestName(mask), mask))
      return
    }
    toast('That share code smudged. The page is blank.')
  }
  showTitle()
}

function uid(): string {
  return `ink-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
}

function artFromMask(name: string, mask: InkMask, id = uid(), sprite?: HTMLCanvasElement): Art {
  const stats = analyze(mask)
  return {
    id,
    name,
    mask,
    sprite: sprite ?? renderMaskCanvas(mask),
    stats,
    code: encodeMask(mask),
  }
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const g = c.getContext('2d')
  if (g) g.drawImage(src, 0, 0)
  return c
}

function thumbOf(sprite: HTMLCanvasElement): string {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 180
  const g = c.getContext('2d')
  if (!g) return ''
  g.fillStyle = '#efe6d2'
  g.fillRect(0, 0, 320, 180)
  const scale = Math.min(300 / sprite.width, 156 / sprite.height)
  const w = sprite.width * scale
  const h = sprite.height * scale
  g.drawImage(sprite, (320 - w) / 2, (180 - h) / 2, w, h)
  try {
    return c.toDataURL('image/jpeg', 0.72)
  } catch {
    return ''
  }
}

function toast(msg: string) {
  const host = document.querySelector('#toasts')
  if (!host) return
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  host.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

function stopAttract() {
  attract?.dispose()
  attract = null
}

function stopPortrait() {
  portrait?.dispose()
  portrait = null
}

function stopRace() {
  race?.dispose()
  race = null
  audio.stopEngine()
  document.body.classList.remove('racing')
}

function setGl(on: boolean) {
  gl.classList.toggle('idle', !on)
}

function showTitle() {
  screen = 'title'
  document.title = 'SKETCH SEND'
  stopRace()
  stopPortrait()
  pad.unmount()
  setGl(true)
  const resume = cup && cup.round < 3
  ui.innerHTML = `
    <section class="screen title">
      <div class="title-copy">
        <p class="eyebrow">Night smear · stands are full</p>
        <h1><span>Sketch</span> <em>Send</em></h1>
        <p class="lede">Draw a side view. The right edge is the nose. Then send that doodle — lime SEND pads, a crowd in the stands, and hazards that want the line more than you do.</p>
        <div class="row">
          <button class="btn primary" data-go="draw">Sketch a sled</button>
          <button class="btn" data-go="scribble">Panic doodle</button>
        </div>
        <div class="row tight">
          <button class="btn ghost" data-go="gallery">Sticker wall</button>
          <button class="btn ghost" data-go="cup">${resume ? `Resume cup · ${cup!.round + 1}/3` : 'Smear Cup'}</button>
          <button class="btn ghost" data-go="loaner">Airtime moth</button>
          <button class="btn ghost" id="mute">${save.settings.sound ? 'Sound on' : 'Sound off'}</button>
        </div>
        <p class="fine">Arrows or A/D steer. Space slides. Shift spends SEND. Purple slicks spin, orange blots glue, cones bounce, sweepers cross the lane.</p>
      </div>
    </section>`
  startAttract()
  bindClicks()
}

function startAttract() {
  stopAttract()
  try {
    const pack = RIVALS.slice(0, 4)
    const specs: RacerSpec[] = pack.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      stats: analyze(r.mask),
      ai: r.ai,
    }))
    const sim = createRace({ track: getTrack('quill'), laps: 99, specs, skipCountdown: true, rubber: true })
    const arts = new Map(
      pack.map((r) => [r.id, { mask: r.mask, sprite: renderMaskCanvas(r.mask, 640), stats: analyze(r.mask) }] as const),
    )
    attract = new RaceView(gl, sim, arts, {
      follow: 'leader',
      reducedMotion,
      getInput: () => ({ steer: 0, brake: 0, drift: false, boost: false }),
      onEvent: () => undefined,
      onHud: () => undefined,
    })
    attract.start()
  } catch {
    setGl(false)
  }
}

function showDraw() {
  screen = 'draw'
  stopAttract()
  stopRace()
  stopPortrait()
  setGl(false)
  ui.innerHTML = `
    <section class="screen draw">
      <header class="bar-top">
        <button class="btn tiny" data-go="title">Back</button>
        <div class="word">Sketch pit</div>
        <p class="hint">Right edge is the nose. Long and low is quick. Heavy and flat stays stuck. Jagged feet slide.</p>
      </header>
      <div class="desk">
        <div class="sheet">
          <div class="nose-tag">Nose →</div>
          <div id="sheet-host"></div>
          <div id="brush-cursor"></div>
        </div>
        <aside class="ticket" id="ticket"></aside>
      </div>
      <footer class="tools">
        <div class="swatches" id="swatches">
          ${INKS.map((ink) => `<button class="swatch ${ink.hex === pad.color ? 'on' : ''}" data-ink="${ink.hex}" style="background:${ink.hex}" title="${ink.name}"></button>`).join('')}
        </div>
        <div class="toolset">
          <button class="btn tiny tool" data-tool="pen">Pen</button>
          <button class="btn tiny tool" data-tool="erase">Erase</button>
          <button class="btn tiny tool" data-tool="fill">Fill</button>
          <label class="size">Weight <input id="size" type="range" min="4" max="48" value="${pad.size}" /></label>
          <button class="btn tiny" id="undo">Undo</button>
          <button class="btn tiny" id="clear">Clear</button>
        </div>
        <div class="row">
          <button class="btn tiny" id="loan-cycle">Steal a rival</button>
          <button class="btn tiny" id="scribble-here">Panic doodle</button>
          <button class="btn primary" id="to-studio">Send it</button>
        </div>
      </footer>
    </section>`
  const host = document.querySelector<HTMLElement>('#sheet-host')!
  pad.mount(host)
  const cursor = document.querySelector<HTMLElement>('#brush-cursor')
  if (cursor) pad.attachCursor(cursor)
  markTools()
  refreshTicket()
  bindClicks()
  document.querySelector('#size')?.addEventListener('input', (e) => {
    pad.size = Number((e.target as HTMLInputElement).value)
  })
  document.querySelector('#undo')?.addEventListener('click', () => {
    audio.blip()
    pad.undoStroke()
  })
  document.querySelector('#clear')?.addEventListener('click', () => {
    audio.blip()
    pad.clear()
  })
  document.querySelector('#to-studio')?.addEventListener('click', () => commitDrawing())
  document.querySelector('#scribble-here')?.addEventListener('click', () => {
    audio.blip()
    const mask = scribble((Math.random() * 1e9) | 0, pad.color)
    paintMask(pad.ctx, mask, pad.canvas.width, pad.canvas.height)
    refreshTicket()
  })
  let loan = 0
  document.querySelector('#loan-cycle')?.addEventListener('click', () => {
    audio.blip()
    const rival = [...RIVALS, LOANER_MOTH][loan++ % (RIVALS.length + 1)]
    pad.color = rival.color
    paintMask(pad.ctx, rival.mask, pad.canvas.width, pad.canvas.height)
    markSwatches()
    refreshTicket()
  })
}

function markTools() {
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tool === pad.tool)
  })
}

function markSwatches() {
  document.querySelectorAll<HTMLButtonElement>('[data-ink]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.ink === pad.color)
  })
}

function refreshTicket() {
  const host = document.querySelector('#ticket')
  if (!host || screen !== 'draw') return
  const mask = canvasToMask(pad.canvas, pad.color)
  const stats = analyze(mask)
  host.innerHTML = ticketHtml(stats, stats.raceable ? 'This sled can send.' : stats.reason)
  const go = document.querySelector('#to-studio')
  go?.toggleAttribute('disabled', !stats.raceable)
}

function ticketHtml(stats: RuntimeStats, note: string): string {
  const bars: [string, number][] = [
    ['Speed', stats.speed],
    ['Thrust', stats.thrust],
    ['Grip', stats.grip],
    ['Drift', stats.drift],
    ['Mass', stats.mass],
  ]
  return `
    <p class="kicker">Setup card</p>
    <h2>${esc(stats.raceable ? stats.read : 'Unread')}</h2>
    ${bars.map(([label, value]) => `<div class="meter"><span>${label}</span><i><b style="width:${value}%"></b></i><em>${value}</em></div>`).join('')}
    <p class="quirk">${esc(stats.quirk)}</p>
    <p class="fine">${esc(note)}</p>`
}

function commitDrawing() {
  const mask = canvasToMask(pad.canvas, pad.color)
  const stats = analyze(mask)
  if (!stats.raceable) {
    toast(stats.reason)
    return
  }
  const keepId = art?.id
  const keepName = art?.name
  art = {
    id: keepId && art ? art.id : uid(),
    name: keepName && art ? art.name : suggestName(mask),
    mask,
    stats,
    code: encodeMask(mask),
    sprite: cloneCanvas(pad.canvas),
  }
  openStudio(art)
}

function openStudio(next: Art, syncPad = false) {
  art = next
  if (syncPad) {
    pad.color = next.mask.color
    paintMask(pad.ctx, next.mask, pad.canvas.width, pad.canvas.height)
  }
  screen = 'studio'
  stopAttract()
  stopRace()
  stopPortrait()
  pad.unmount()
  setGl(false)
  const cupRound = cup && cup.round < 3 ? cup : null
  const forced = cupModeActive()
  const track = getTrack(forced ? CUP_TRACKS[cupRound?.round ?? 0] : trackId)
  if (forced) trackId = track.id
  ui.innerHTML = `
    <section class="screen studio">
      <header class="bar-top">
        <button class="btn tiny" data-go="draw">Redraw</button>
        <div class="word">${forced ? `Smear Cup · round ${(cup!.round % 3) + 1} / 3` : 'Line check'}</div>
        <button class="btn tiny" data-go="gallery">Sticker wall</button>
      </header>
      <div class="studio-grid">
        <div class="stage">
          <canvas id="portrait"></canvas>
          <p class="fine stage-note">${esc(art.stats.quirk)}</p>
        </div>
        <div class="studio-side">
          <label class="name-label">Name
            <input id="racer-name" maxlength="22" value="${esc(art.name)}" />
          </label>
          ${ticketHtml(art.stats, art.stats.read)}
          ${forced ? cupTableHtml() : ''}
          <div class="choices">
            <div class="choice-label">Circuit</div>
            <div class="track-grid">
              ${(forced ? [track] : TRACKS).map((t) => trackCard(t)).join('')}
            </div>
          </div>
          ${
            forced
              ? ''
              : `<div class="choices inline">
            <div>
              <div class="choice-label">Laps</div>
              <div class="segment" id="laps">
                ${[3, 5, 8].map((n) => `<button data-laps="${n}" class="${n === laps ? 'on' : ''}">${n}</button>`).join('')}
              </div>
            </div>
            <div>
              <div class="choice-label">Field</div>
              <div class="segment" id="field">
                <button data-field="0" class="${field === 0 ? 'on' : ''}">Ghost Lap</button>
                <button data-field="3" class="${field === 3 ? 'on' : ''}">Pack Heat</button>
                <button data-field="5" class="${field === 5 ? 'on' : ''}">Full Grid</button>
              </div>
            </div>
          </div>`
          }
          <div class="share-box">
            <label>Send link <input id="share-code" readonly value="${esc(art.code)}" /></label>
            <button class="btn tiny" id="copy-share">Copy send</button>
          </div>
          <button class="btn primary xl" id="start-race">${forced ? 'Send this round' : 'Send the line'}</button>
          <p class="fine">Arrows or A/D steer · Space drift · Shift spends SEND · S brakes. Lime gates are SEND pads. Purple slicks spin, orange blots glue, cones bounce, the sweeper crosses. Red speed means the corner is tighter than you are.</p>
        </div>
      </div>
    </section>`
  const canvas = document.querySelector<HTMLCanvasElement>('#portrait')!
  portrait = new Portrait(canvas, { mask: art.mask, sprite: art.sprite, stats: art.stats })
  requestAnimationFrame(() => portrait?.resize())
  bindClicks()
  document.querySelector('#racer-name')?.addEventListener('input', (e) => {
    if (!art) return
    art.name = (e.target as HTMLInputElement).value.slice(0, 22) || 'Nameless Sled'
  })
  document.querySelector('#start-race')?.addEventListener('click', () => beginRace())
  document.querySelector('#copy-share')?.addEventListener('click', () => copyShare())
  document.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (cupModeActive()) return
      trackId = btn.dataset.track || 'quill'
      audio.blip()
      document.querySelectorAll('[data-track]').forEach((el) => el.classList.toggle('on', (el as HTMLElement).dataset.track === trackId))
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-laps]').forEach((btn) => {
    btn.addEventListener('click', () => {
      laps = Number(btn.dataset.laps) as 3 | 5 | 8
      audio.blip()
      document.querySelectorAll('[data-laps]').forEach((el) => el.classList.toggle('on', (el as HTMLElement).dataset.laps === String(laps)))
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-field]').forEach((btn) => {
    btn.addEventListener('click', () => {
      field = Number(btn.dataset.field) as 0 | 3 | 5
      audio.blip()
      document.querySelectorAll('[data-field]').forEach((el) => el.classList.toggle('on', (el as HTMLElement).dataset.field === String(field)))
    })
  })
}

function cupModeActive(): boolean {
  return !!cup && cup.round < 3 && cup.code === art?.code
}

function trackCard(t: BuiltTrack): string {
  const best = bestTime(t.id)
  return `<button class="track-card ${t.id === trackId ? 'on' : ''}" data-track="${t.id}">
    ${trackSvg(t)}
    <strong>${esc(t.name)}</strong>
    <em>${esc(t.tagline)}</em>
    <small>${best != null ? `Best ${formatTime(best)}` : 'No send yet'}</small>
  </button>`
}

function bestTime(id: string): number | null {
  if (!art) return null
  const item = save.gallery.find((g) => g.id === art!.id || g.code === art!.code)
  return item?.bests[id]?.race ?? null
}

function cupTableHtml(): string {
  if (!cup) return ''
  const rows = [...cup.points].sort((a, b) => b.pts - a.pts)
  if (!rows.length) return `<p class="fine">Three circuits. Ten points if you send it first.</p>`
  return `<ol class="cup-mini">${rows
    .map((r) => `<li class="${r.you ? 'you' : ''}"><span>${esc(r.name)}</span><b>${r.pts}</b></li>`)
    .join('')}</ol>`
}

function copyShare() {
  if (!art) return
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('ink', art.code)
  const text = url.toString()
  const sled = art.name
  void navigator.clipboard?.writeText(text).then(
    () => toast(`Send link copied. ${sled} is ready to ride.`),
    () => toast('Copy the send link from the field.'),
  )
  audio.blip()
}

function beginRace() {
  if (!art || !art.stats.raceable) {
    toast('That ink is too faint to race.')
    return
  }
  const forced = cupModeActive()
  const useField = forced ? 3 : field
  const useLaps = forced ? 3 : laps
  field = useField
  laps = useLaps
  const useTrack = getTrack(forced ? CUP_TRACKS[cup!.round] : trackId)
  trackId = useTrack.id
  laps = useLaps
  const specs: RacerSpec[] = []
  const arts = new Map<string, { mask: InkMask; sprite: HTMLCanvasElement; stats: RuntimeStats }>()
  const player: RacerSpec = {
    id: 'you',
    name: art.name || 'Nameless Sled',
    color: art.mask.color,
    stats: art.stats,
    isPlayer: true,
  }
  arts.set('you', { mask: art.mask, sprite: art.sprite, stats: art.stats })
  const rivals = RIVALS.slice(0, useField)
  if (rivals[0]) specs.push(rivalSpec(rivals[0], arts))
  specs.push(player)
  for (const rival of rivals.slice(1)) specs.push(rivalSpec(rival, arts))
  if (useField === 0) {
    const saved = findGhost(save, ghostKey(useTrack.id, useLaps, art.code))
    if (saved) {
      const frames = unpackGhost(saved.b64, useTrack.length)
      if (frames.length > 4) {
        specs.push({
          id: 'ghost',
          name: 'Your Ghost',
          color: art.mask.color,
          stats: art.stats,
          isGhost: true,
          ghost: { frames, dt: 0.1 },
        })
        arts.set('ghost', { mask: art.mask, sprite: art.sprite, stats: art.stats })
      }
    }
  }
  const sim = createRace({
    track: useTrack,
    laps: useLaps,
    specs,
    rubber: useField !== 0,
  })
  stopPortrait()
  stopAttract()
  stopRace()
  ended = false
  lastCount = 4
  steerSmooth = 0
  screen = 'race'
  document.body.classList.add('racing')
  setGl(true)
  ui.innerHTML = hudHtml(useField === 0, useTrack.name)
  document.title = `SKETCH SEND — ${useTrack.name}`
  bindTouch()
  document.querySelector('#pause-btn')?.addEventListener('click', () => togglePause())
  document.querySelector('#resume')?.addEventListener('click', () => togglePause(false))
  document.querySelector('#retire')?.addEventListener('click', () => {
    stopRace()
    setGl(false)
    if (art) openStudio(art)
  })
  try {
    race = new RaceView(gl, sim, arts, {
      follow: 'player',
      reducedMotion,
      getInput: readInput,
      onEvent: onRaceEvent,
      onHud: onHud,
    })
    const map = document.querySelector<HTMLCanvasElement>('#minimap')
    if (map) race.attachMinimap(map)
    race.start()
  } catch {
    toast('The circuit could not start in this browser.')
    if (art) openStudio(art)
  }
  if (!save.settings.coached) {
    save.settings.coached = true
    writeSave(save)
    const coach = document.querySelector('#coach')
    coach?.classList.add('show')
    setTimeout(() => coach?.classList.remove('show'), 7000)
  }
}

function rivalSpec(
  rival: (typeof RIVALS)[number],
  arts: Map<string, { mask: InkMask; sprite: HTMLCanvasElement; stats: RuntimeStats }>,
): RacerSpec {
  const stats = analyze(rival.mask)
  arts.set(rival.id, { mask: rival.mask, sprite: renderMaskCanvas(rival.mask, 720), stats })
  return { id: rival.id, name: rival.name, color: rival.color, stats, ai: rival.ai }
}

function hudHtml(trial: boolean, trackName: string): string {
  return `
    <section class="hud">
      <header class="hud-top">
        <div>
          <div class="place" id="hud-place">–</div>
          <div class="field-note" id="hud-field">${trial ? 'Ghost Lap' : 'Live heat'} · ${esc(trackName)}</div>
        </div>
        <div class="lapblock">
          <div id="hud-lap">1/3</div>
          <div id="hud-time">0:00.00</div>
          <div class="subtimes"><span id="hud-last"></span><span id="hud-best"></span></div>
        </div>
        <button class="btn tiny" id="pause-btn" type="button">Pause</button>
      </header>
      <ol id="hud-rows"></ol>
      <div id="count" class="count"></div>
      <div id="banner" class="banner"></div>
      <div id="coach" class="coach">Hold <b>Space</b> in the bend to slide and fill SEND. <b>Shift</b> spends it. Purple slicks spin you. Orange blots glue the wheels. Cones bounce. The sweeper crosses the lane.</div>
      <footer class="hud-bottom">
        <div class="speed-block">
          <div id="hud-speed" class="speed">0</div>
          <span>spd</span>
        </div>
        <div class="vial" aria-label="Boost">
          <div id="hud-boost"></div>
        </div>
        <canvas id="minimap" width="168" height="168"></canvas>
      </footer>
      <div class="touch">
        <button type="button" data-hold="touch-left" aria-label="Steer left">◀</button>
        <button type="button" data-hold="touch-drift">Drift</button>
        <button type="button" data-hold="touch-brake">Brake</button>
        <button type="button" data-hold="touch-boost">Boost</button>
        <button type="button" data-hold="touch-right" aria-label="Steer right">▶</button>
      </div>
      <div id="pause" class="pause">
        <div class="panel">
          <h2>Line held.</h2>
          <p>The crowd can wait.</p>
          <div class="row">
            <button class="btn primary" id="resume" type="button">Resume</button>
            <button class="btn" id="retire" type="button">Retire</button>
          </div>
        </div>
      </div>
    </section>`
}

function bindTouch() {
  document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((btn) => {
    const key = btn.dataset.hold!
    const down = (e: PointerEvent) => {
      e.preventDefault()
      keys.add(key)
      btn.classList.add('held')
      btn.setPointerCapture(e.pointerId)
    }
    const up = () => {
      keys.delete(key)
      btn.classList.remove('held')
    }
    btn.addEventListener('pointerdown', down)
    btn.addEventListener('pointerup', up)
    btn.addEventListener('pointercancel', up)
  })
}

function readInput(): Input {
  let steer = 0
  if (keys.has('arrowleft') || keys.has('a') || keys.has('touch-left')) steer -= 1
  if (keys.has('arrowright') || keys.has('d') || keys.has('touch-right')) steer += 1
  const pads = navigator.getGamepads?.()
  const gp = pads ? pads[0] : null
  if (gp) {
    const ax = gp.axes[0] ?? 0
    if (Math.abs(ax) > 0.16) steer = clamp(ax, -1, 1)
  }
  steerSmooth += (steer - steerSmooth) * 0.45
  const brake =
    keys.has('arrowdown') ||
    keys.has('s') ||
    keys.has('touch-brake') ||
    !!gp?.buttons[1]?.pressed ||
    !!gp?.buttons[6]?.pressed
  const drift =
    keys.has(' ') || keys.has('touch-drift') || !!gp?.buttons[0]?.pressed || !!gp?.buttons[5]?.pressed
  const boost =
    keys.has('shift') || keys.has('e') || keys.has('touch-boost') || !!gp?.buttons[7]?.pressed || !!gp?.buttons[2]?.pressed
  return { steer: steerSmooth, brake: brake ? 1 : 0, drift, boost }
}

function onRaceEvent(e: SimEvent) {
  if (e.type === 'go') flashCount('GO', true)
  if (e.type === 'lap' && e.lap < laps) {
    audio.lap()
    flashBanner(`LAP ${e.lap + 1}`)
  }
  if (e.type === 'finish') finishRace()
  if (e.type === 'hit') audio.hit()
  if (e.type === 'pad') {
    audio.pad()
    flashBanner('SEND')
  }
  if (e.type === 'hazard') {
    if (e.kind === 'slick') audio.slick()
    else if (e.kind === 'sticky') audio.sticky()
    else if (e.kind === 'cone') audio.cone()
    else audio.sweeper()
    const shout = e.kind === 'slick' ? 'SLICK' : e.kind === 'sticky' ? 'STUCK' : e.kind === 'cone' ? 'CONE' : 'SWEEP'
    flashBanner(shout)
  }
  if (e.type === 'boost') audio.boost()
}

function onHud(h: HudSnap) {
  const place = document.querySelector('#hud-place')
  if (!place) return
  place.textContent = ordinal(h.place)
  const lap = document.querySelector('#hud-lap')
  if (lap) lap.textContent = h.lapText
  const time = document.querySelector('#hud-time')
  if (time) time.textContent = formatTime(h.time)
  const last = document.querySelector('#hud-last')
  if (last) last.textContent = h.lastLap != null ? `Last ${formatTime(h.lastLap)}` : ''
  const best = document.querySelector('#hud-best')
  if (best) best.textContent = h.bestLap != null ? `Best ${formatTime(h.bestLap)}` : ''
  const speed = document.querySelector('#hud-speed')
  if (speed) {
    speed.textContent = String(h.speed)
    speed.classList.toggle('hot', h.hot)
  }
  const boost = document.querySelector<HTMLElement>('#hud-boost')
  if (boost) {
    boost.style.height = `${Math.round(h.boost * 100)}%`
    boost.classList.toggle('hot', h.boosting)
  }
  const list = document.querySelector('#hud-rows')
  if (list) {
    list.innerHTML = h.rows
      .map(
        (r, i) =>
          `<li class="${r.you ? 'you' : ''}"><b>${i + 1}</b><span>${esc(r.name)}</span><em>${r.detail}</em></li>`,
      )
      .join('')
  }
  if (!h.started && h.countdown > 0) {
    const n = Math.ceil(h.countdown)
    if (n !== lastCount && n > 0 && n <= 3) {
      lastCount = n
      audio.count(n)
      flashCount(String(n), false)
    }
  }
  audio.setEngine(h.speed / 230, h.drifting, h.boosting)
}

function flashCount(text: string, go: boolean) {
  const el = document.querySelector('#count')
  if (!el) return
  el.textContent = text
  el.classList.remove('pop')
  void (el as HTMLElement).offsetWidth
  el.classList.add('pop')
  if (go) audio.count(0)
}

function flashBanner(text: string) {
  const el = document.querySelector('#banner')
  if (!el) return
  el.textContent = text
  el.classList.remove('pop')
  void (el as HTMLElement).offsetWidth
  el.classList.add('pop')
  window.clearTimeout(bannerTimer)
  bannerTimer = window.setTimeout(() => el.classList.remove('pop'), 900)
}

function togglePause(force?: boolean) {
  const panel = document.querySelector('#pause')
  if (!panel || !race) return
  const show = force ?? !panel.classList.contains('show')
  panel.classList.toggle('show', show)
  race.setPaused(show)
  if (show) audio.stopEngine()
}

function finishRace() {
  if (ended || !race || !art) return
  ended = true
  audio.lap()
  flashBanner('FINISH')
  race.celebrate()
  const sim = (race as unknown as { sim: import('./sim').Sim }).sim
  void sim
  result = collectResult()
  window.setTimeout(() => {
    if (result) showResults(result)
  }, 1100)
}

function collectResult(): RaceResult | null {
  if (!race || !art) return null
  const sim = race.getSim()
  const player = sim.racers.find((r) => r.isPlayer)
  if (!player) return null
  const rows = standings(sim)
    .filter((r) => !r.isGhost)
    .map((r, i) => ({
      name: r.name,
      you: r.isPlayer,
      time: r.finishTime,
      place: i + 1,
    }))
  const place = rows.find((r) => r.you)?.place ?? rows.length
  const saved = findGhost(save, ghostKey(sim.track.id, sim.laps, art.code))
  const ghostRace = field === 0 ? saved?.race ?? null : null
  const beatGhost = ghostRace != null && player.finishTime != null ? player.finishTime < ghostRace : null
  const pts = field === 0 ? 0 : (POINTS[place - 1] ?? 0)
  return {
    place,
    field: rows.length,
    time: player.finishTime ?? sim.time,
    bestLap: player.bestLap,
    trackId: sim.track.id,
    trackName: sim.track.name,
    laps: sim.laps,
    rows,
    ghostRace,
    beatGhost,
    points: pts,
  }
}

function showResults(res: RaceResult) {
  if (!art) return
  screen = 'results'
  audio.stopEngine()
  const frames = race?.takeGhost() ?? []
  const key = ghostKey(res.trackId, res.laps, art.code)
  const prev = findGhost(save, key)
  if (!prev || res.time < prev.race) {
    saveGhost(save, key, res.time, res.bestLap ?? res.time, frames, getTrack(res.trackId).length)
  }
  const item: GalleryItem = {
    id: art.id,
    name: art.name,
    code: art.code,
    created: Date.now(),
    races: 1,
    wins: res.field > 1 && res.place === 1 ? 1 : 0,
    cups: 0,
    bests: { [res.trackId]: { race: res.time, lap: res.bestLap ?? res.time } },
    thumb: thumbOf(art.sprite),
  }
  let cupNote = ''
  let cupBoard = ''
  if (cup && cup.code === art.code && cup.round < 3) {
    const sim = race?.getSim()
    if (sim) awardCup(sim)
    cupBoard = cupTableHtml()
    if (cup.round >= 3) {
      const winner = [...cup.points].sort((a, b) => b.pts - a.pts)[0]
      const youWon = !!winner?.you
      if (youWon) item.cups = 1
      cupNote = youWon ? 'Smear Cup is yours. The sled held.' : `${winner?.name ?? 'Someone'} lifts the Smear Cup.`
      cup = null
      save.cup = null
      writeSave(save)
    } else {
      save.cup = cup
      writeSave(save)
      cupNote = `Round filed. Next circuit: ${getTrack(CUP_TRACKS[cup.round]).name}.`
    }
  }
  upsertGallery(save, item)
  const win = res.place === 1 && res.field > 1
  ui.innerHTML = `
    <section class="screen results">
      ${win ? confetti() : ''}
      <div class="results-card">
        <p class="eyebrow">${esc(res.trackName)} · ${res.laps} laps</p>
        <h1 class="${win ? 'win' : ''}">${ordinal(res.place)}</h1>
        <p class="big-time">${formatTime(res.time)}</p>
        <p class="fine">Best lap ${formatTime(res.bestLap)} ${res.points ? `· ${res.points} cup pts` : ''}</p>
        ${res.beatGhost === true ? '<p class="quirk">You erased the ghost.</p>' : ''}
        ${res.beatGhost === false && res.ghostRace != null ? `<p class="quirk">Your Ghost still has the line by ${formatTime(res.ghostRace - res.time)}.</p>` : ''}
        ${cupNote ? `<p class="quirk">${esc(cupNote)}</p>` : ''}
        <ol class="results-list">
          ${res.rows
            .map((row) => {
              const gap = row.you || row.time == null || res.time == null ? '' : formatTime(row.time - res.time)
              return `<li class="${row.you ? 'you' : ''}"><b>${ordinal(row.place)}</b><span>${esc(row.name)}</span><em>${row.time != null ? formatTime(row.time) : 'running'}</em><small>${row.you ? '' : gap}</small></li>`
            })
            .join('')}
        </ol>
        ${cupBoard}
        <div class="row">
          <button class="btn primary" id="rematch">Rematch</button>
          ${cup && cup.round < 3 ? '<button class="btn" id="next-cup">Next round</button>' : '<button class="btn" id="next-track">Next circuit</button>'}
          <button class="btn" data-go="draw">Redraw</button>
          <button class="btn ghost" data-go="gallery">Sticker wall</button>
        </div>
      </div>
    </section>`
  bindClicks()
  document.querySelector('#rematch')?.addEventListener('click', () => {
    audio.blip()
    beginRace()
  })
  document.querySelector('#next-track')?.addEventListener('click', () => {
    audio.blip()
    const i = TRACKS.findIndex((t) => t.id === trackId)
    trackId = TRACKS[(i + 1) % TRACKS.length].id
    beginRace()
  })
  document.querySelector('#next-cup')?.addEventListener('click', () => {
    audio.blip()
    beginRace()
  })
}

function awardCup(sim: Sim) {
  if (!cup || !art) return
  const rows = standings(sim).filter((r) => !r.isGhost)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const key = r.isPlayer ? 'you' : r.id
    const pts = POINTS[i] ?? 0
    let entry = cup.points.find((p) => p.key === key)
    if (!entry) {
      entry = { key, name: r.isPlayer ? art.name : r.name, pts: 0, you: r.isPlayer }
      cup.points.push(entry)
    }
    if (r.isPlayer) entry.name = art.name
    entry.pts += pts
  }
  cup.round += 1
  cup.name = art.name
}

function confetti(): string {
  const bits = Array.from({ length: 18 }, (_, i) => {
    const left = (i * 53) % 100
    const delay = (i % 6) * 0.08
    const color = i % 2 ? '#d6f25c' : '#ef4b32'
    return `<i style="left:${left}%;animation-delay:${delay}s;background:${color}"></i>`
  })
  return `<div class="confetti">${bits.join('')}</div>`
}

function showGallery() {
  screen = 'gallery'
  stopAttract()
  stopRace()
  stopPortrait()
  pad.unmount()
  setGl(false)
  const cards = save.gallery
  ui.innerHTML = `
    <section class="screen gallery">
      <header class="bar-top">
        <button class="btn tiny" data-go="title">Back</button>
        <div class="word">Sticker wall</div>
        <button class="btn tiny" id="paste-go">Open a code</button>
      </header>
      <div class="paste">
        <input id="paste-code" placeholder="Paste a send link or an INK1 code" />
      </div>
      ${
        cards.length
          ? `<div class="gallery-grid">${cards.map(galleryCard).join('')}</div>`
          : `<div class="empty"><h2>No sleds yet.</h2><p>Sketch a belly and a nose. It waits on this browser for the next send.</p><button class="btn primary" data-go="draw">Sketch a sled</button></div>`
      }
    </section>`
  bindClicks()
  document.querySelector('#paste-go')?.addEventListener('click', () => openPasted())
  document.querySelector('#paste-code')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') openPasted()
  })
  document.querySelectorAll<HTMLButtonElement>('[data-race-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = save.gallery.find((g) => g.id === btn.dataset.raceId)
      if (!item) return
      const mask = decodeMask(item.code)
      if (!mask) {
        toast('That card’s ink dried wrong.')
        return
      }
      audio.blip()
      openStudio(artFromMask(item.name, mask, item.id), true)
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-copy-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = save.gallery.find((g) => g.id === btn.dataset.copyId)
      if (!item) return
      art = artFromMask(item.name, decodeMask(item.code) ?? scribble(1, INKS[0].hex), item.id)
      copyShare()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-del-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delId!
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1'
        btn.textContent = 'Sure?'
        setTimeout(() => {
          btn.dataset.armed = '0'
          btn.textContent = 'Drop'
        }, 1800)
        return
      }
      removeGallery(save, id)
      audio.blip()
      showGallery()
    })
  })
}

function galleryCard(item: GalleryItem): string {
  const bests = Object.entries(item.bests)
  const best = bests.sort((a, b) => a[1].race - b[1].race)[0]
  const trackName = best ? getTrack(best[0]).name : 'No races yet'
  const mask = decodeMask(item.code)
  const stats = mask ? analyze(mask) : null
  return `<article class="g-card">
    <div class="g-thumb">${item.thumb ? `<img alt="" src="${item.thumb}" />` : ''}</div>
    <h3>${esc(item.name)}</h3>
    <p>${esc(stats?.quirk ?? 'Ink')}</p>
    <p class="fine">${item.races} races · ${item.wins} wins${item.cups ? ` · ${item.cups} cups` : ''}<br/>${esc(trackName)} ${best ? formatTime(best[1].race) : ''}</p>
    <div class="row tight">
      <button class="btn tiny" data-race-id="${esc(item.id)}">Race</button>
      <button class="btn tiny" data-copy-id="${esc(item.id)}">Share</button>
      <button class="btn tiny danger" data-del-id="${esc(item.id)}">Drop</button>
    </div>
  </article>`
}

function openPasted() {
  const input = document.querySelector<HTMLInputElement>('#paste-code')
  const mask = decodeMask(extractCode(input?.value ?? ''))
  if (!mask) {
    toast('That code doesn’t hold ink.')
    return
  }
  const stats = analyze(mask)
  if (!stats.raceable) {
    toast(stats.reason)
    return
  }
  audio.blip()
  openStudio(artFromMask(suggestName(mask), mask), true)
}

function bindClicks() {
  ui.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      audio.blip()
      const go = el.dataset.go
      if (go === 'title') showTitle()
      if (go === 'draw') showDraw()
      if (go === 'gallery') showGallery()
      if (go === 'scribble') {
        const mask = scribble((Math.random() * 1e9) | 0, INKS[(Math.random() * INKS.length) | 0].hex)
        openStudio(artFromMask(suggestName(mask), mask), true)
      }
      if (go === 'loaner') {
        openStudio(artFromMask(LOANER_MOTH.name, LOANER_MOTH.mask), true)
      }
      if (go === 'cup') startCup()
    })
  })
  document.querySelector('#mute')?.addEventListener('click', () => {
    save.settings.sound = !save.settings.sound
    audio.setMuted(!save.settings.sound)
    writeSave(save)
    const btn = document.querySelector('#mute')
    if (btn) btn.textContent = save.settings.sound ? 'Sound on' : 'Sound off'
    audio.blip()
  })
  ui.querySelectorAll<HTMLButtonElement>('[data-ink]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pad.color = btn.dataset.ink || INKS[0].hex
      markSwatches()
      audio.blip()
      refreshTicket()
    })
  })
  ui.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pad.tool = (btn.dataset.tool as 'pen' | 'erase' | 'fill') || 'pen'
      markTools()
      audio.blip()
    })
  })
}

function startCup() {
  if (cup && cup.round < 3) {
    const mask = decodeMask(cup.code)
    if (mask) {
      const same = art?.code === cup.code ? art : artFromMask(cup.name, mask)
      field = 3
      laps = 3
      trackId = CUP_TRACKS[cup.round] ?? 'quill'
      openStudio(same, art?.code !== cup.code)
      return
    }
  }
  if (!art) {
    const latest = save.gallery[0]
    const mask = latest ? decodeMask(latest.code) : null
    if (latest && mask) art = artFromMask(latest.name, mask, latest.id)
  }
  if (!art) {
    const mask = scribble(99 + ((Math.random() * 500) | 0), INKS[2].hex)
    art = artFromMask(suggestName(mask), mask)
    toast('A panic doodle is in the Smear Cup. Redraw if you want your own hand.')
  }
  cup = { round: 0, name: art.name, code: art.code, points: [] }
  save.cup = cup
  writeSave(save)
  field = 3
  laps = 3
  trackId = CUP_TRACKS[0]
  openStudio(art, true)
}
