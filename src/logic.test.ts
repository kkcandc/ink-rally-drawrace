import { describe, expect, it } from 'vitest'
import { analyze, decodeMask, encodeMask, RIVALS, scribble } from './ink'
import { aiInput, createRace, progressOf, stepSim } from './sim'
import { getTrack, rightContinuity, TRACKS, trackCrosses } from './tracks'

describe('share codes', () => {
  it('round-trips masks and colors', () => {
    for (const rival of RIVALS) {
      const code = encodeMask(rival.mask)
      expect(code.startsWith('INK1.')).toBe(true)
      const back = decodeMask(code)
      expect(back).not.toBeNull()
      expect(back!.color).toBe(rival.color)
      expect(back!.w).toBe(rival.mask.w)
      expect(back!.bits.length).toBe(rival.mask.bits.length)
      for (let i = 0; i < rival.mask.bits.length; i++) {
        expect(back!.bits[i]).toBe(rival.mask.bits[i] ? 1 : 0)
      }
    }
  })

  it('pulls a code out of a pasted url', () => {
    const code = encodeMask(RIVALS[0].mask)
    const back = decodeMask(`https://ink.example/?ink=${encodeURIComponent(code)}&laps=3`)
    expect(back?.color).toBe(RIVALS[0].color)
  })

  it('rejects junk', () => {
    expect(decodeMask('nope')).toBeNull()
    expect(decodeMask('INK1.aaaa')).toBeNull()
  })
})

describe('silhouette stats', () => {
  it('makes the newt faster than the bison and the bison grippier', () => {
    const newt = analyze(RIVALS[0].mask)
    const bison = analyze(RIVALS[1].mask)
    const mantis = analyze(RIVALS[2].mask)
    expect(newt.raceable && bison.raceable && mantis.raceable).toBe(true)
    expect(newt.topSpeed).toBeGreaterThan(bison.topSpeed + 0.6)
    expect(bison.gripCoef).toBeGreaterThan(newt.gripCoef)
    expect(mantis.driftCoef).toBeGreaterThan(bison.driftCoef)
  })

  it('scribbles a deterministic raceable ink', () => {
    const a = scribble(7, '#147a86')
    const b = scribble(7, '#147a86')
    expect(analyze(a).raceable).toBe(true)
    expect(encodeMask(a)).toBe(encodeMask(b))
  })
})

describe('tracks', () => {
  it('builds closed circuits that do not cross and keep a steady frame', () => {
    for (const track of TRACKS) {
      expect(track.length).toBeGreaterThan(600)
      expect(track.length).toBeLessThan(2200)
      expect(trackCrosses(track)).toBe(false)
      expect(rightContinuity(track)).toBeGreaterThan(0.9)
      const pads = new Set(track.samples.map((s) => s.pad).filter(Boolean))
      expect(pads.size).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('racing', () => {
  it('records a real lap, not the launch, and a steady driver scrapes less than a statue', () => {
    const track = getTrack('quill')
    const stats = analyze(RIVALS[0].mask)
    const drive = (mode: 'ai' | 'statue') => {
      const sim = createRace({
        track,
        laps: 2,
        skipCountdown: true,
        rubber: false,
        specs: [
          {
            id: 'p',
            name: 'Driver',
            color: '#147a86',
            stats,
            isPlayer: true,
            ai: mode === 'ai' ? { skill: 1, aggression: 0.72, lineBias: 0, seed: 2 } : null,
          },
        ],
      })
      const player = sim.racers[0]
      let steps = 0
      let maxX = 0
      while (player.lapsDone < 1 && steps < 60 * 100) {
        stepSim(sim, 1 / 60, (r) =>
          mode === 'ai' ? aiInput(sim, { ...r, ai: r.ai ?? { skill: 1, aggression: 0.72, lineBias: 0, seed: 2 } }) : { steer: 0, brake: 0, drift: false, boost: false },
        )
        steps++
        maxX = Math.max(maxX, Math.abs(player.x))
      }
      return {
        laps: player.lapsDone,
        best: player.bestLap,
        scrape: player.scrapeTime,
        time: sim.time,
        progress: progressOf(player, track.length),
        speed: progressOf(player, track.length) / Math.max(0.1, sim.time),
        maxX,
      }
    }
    const ai = drive('ai')
    const statue = drive('statue')
    expect(ai.laps).toBeGreaterThanOrEqual(1)
    expect(ai.best ?? 0).toBeGreaterThan(18)
    expect(ai.best ?? 999).toBeLessThan(70)
    expect(ai.speed).toBeGreaterThan(16)
    expect(statue.scrape).toBeGreaterThan(ai.scrape + 0.4)
  })

  it('keeps a full field moving on every circuit', () => {
    for (const track of TRACKS) {
      const specs = RIVALS.slice(0, 4).map((rival, i) => ({
        id: rival.id,
        name: rival.name,
        color: rival.color,
        stats: analyze(rival.mask),
        isPlayer: i === 2,
        ai: i === 2 ? null : rival.ai,
      }))
      const sim = createRace({ track, laps: 2, skipCountdown: true, rubber: true, specs })
      const player = sim.racers[2]
      let steps = 0
      while (player.lapsDone < 1 && steps < 60 * 120) {
        stepSim(sim, 1 / 60, (r) =>
          r.isPlayer
            ? aiInput(sim, { ...r, ai: { skill: 0.95, aggression: 0.7, lineBias: 0, seed: 4 } })
            : { steer: 0, brake: 0, drift: false, boost: false },
        )
        steps++
      }
      const scrapeRatio = player.scrapeTime / Math.max(1, sim.time)
      expect(player.lapsDone).toBeGreaterThanOrEqual(1)
      expect(player.bestLap ?? 0).toBeGreaterThan(18)
      expect(player.bestLap ?? 999).toBeLessThan(75)
      expect(scrapeRatio).toBeLessThan(0.22)
      for (const r of sim.racers) {
        expect(Number.isFinite(r.v)).toBe(true)
        expect(r.lapsDone + progressOf(r, track.length) / track.length).toBeGreaterThan(0.4)
      }
    }
  })
})
