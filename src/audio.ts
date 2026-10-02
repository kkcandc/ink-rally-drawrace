export class AudioBus {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engine: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  muted = false

  unlock() {
    if (this.muted) return
    const ctx = this.ensure()
    if (ctx.state === 'suspended') void ctx.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master) this.master.gain.value = m ? 0 : 0.9
    if (m) this.stopEngine()
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.9
      this.master.connect(this.ctx.destination)
    }
    return this.ctx
  }

  private env(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0) {
    if (this.muted) return
    const ctx = this.ensure()
    if (!this.master) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur)
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
    o.connect(g)
    g.connect(this.master)
    o.start()
    o.stop(ctx.currentTime + dur + 0.02)
  }

  blip() {
    this.env(520, 0.07, 'square', 0.04, 180)
  }

  count(n: number) {
    this.env(n === 0 ? 880 : 440 + (3 - n) * 40, n === 0 ? 0.28 : 0.12, 'square', 0.05, n === 0 ? 200 : 0)
  }

  lap() {
    this.env(660, 0.18, 'triangle', 0.05, 220)
  }

  hit() {
    this.env(90, 0.16, 'sawtooth', 0.06, -40)
  }

  slick() {
    this.env(240, 0.28, 'sawtooth', 0.05, -160)
    this.env(620, 0.12, 'square', 0.03, 80)
  }

  sticky() {
    this.env(70, 0.32, 'triangle', 0.07, -30)
  }

  cone() {
    this.env(180, 0.09, 'square', 0.06, -90)
    this.env(90, 0.14, 'sawtooth', 0.05, -40)
  }

  sweeper() {
    this.env(140, 0.22, 'square', 0.06, 60)
    this.env(80, 0.18, 'sawtooth', 0.05, -50)
  }

  pad() {
    this.env(520, 0.2, 'square', 0.045, 300)
  }

  boost() {
    this.env(180, 0.35, 'sawtooth', 0.04, 240)
  }

  setEngine(amount: number, drift: boolean, boosting: boolean) {
    if (this.muted) return
    const ctx = this.ensure()
    if (!this.master) return
    if (!this.engine) {
      this.engine = ctx.createOscillator()
      this.engine.type = 'sawtooth'
      this.filter = ctx.createBiquadFilter()
      this.filter.type = 'lowpass'
      this.filter.frequency.value = 240
      this.engineGain = ctx.createGain()
      this.engineGain.gain.value = 0
      this.engine.connect(this.filter)
      this.filter.connect(this.engineGain)
      this.engineGain.connect(this.master)
      this.engine.start()
    }
    const a = Math.max(0, Math.min(1, amount))
    const freq = 46 + a * 78 + (boosting ? 24 : 0) + (drift ? 10 : 0)
    const g = 0.012 + a * 0.03 + (boosting ? 0.012 : 0)
    this.engine?.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05)
    this.engineGain?.gain.setTargetAtTime(g, ctx.currentTime, 0.05)
    if (this.filter) this.filter.frequency.setTargetAtTime(180 + a * 520, ctx.currentTime, 0.08)
  }

  stopEngine() {
    if (!this.engine || !this.ctx) return
    try {
      this.engine.stop()
    } catch {
      /* already stopped */
    }
    this.engine.disconnect()
    this.engine = null
    this.engineGain = null
    this.filter = null
  }
}
