export type DrawTool = 'pen' | 'erase' | 'fill'

export class DrawPad {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  tool: DrawTool = 'pen'
  size = 18
  color = '#1c1915'
  private drawing = false
  private lastX = 0
  private lastY = 0
  private undo: ImageData[] = []
  private onChange: (() => void) | null = null
  onNote: ((s: string) => void) | null = null
  private cursor: HTMLElement | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 1200
    this.canvas.height = 675
    this.canvas.className = 'ink-canvas'
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
    this.bind()
  }

  setOnChange(fn: () => void) {
    this.onChange = fn
  }

  mount(host: HTMLElement) {
    host.appendChild(this.canvas)
  }

  unmount() {
    this.canvas.remove()
    this.cursor?.remove()
    this.cursor = null
  }

  clear() {
    this.pushUndo()
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.onChange?.()
  }

  undoStroke() {
    const prev = this.undo.pop()
    if (!prev) return
    this.ctx.putImageData(prev, 0, 0)
    this.onChange?.()
  }

  private pushUndo() {
    this.undo.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height))
    if (this.undo.length > 8) this.undo.shift()
  }

  private bind() {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => {
      if (this.tool === 'fill') {
        this.pushUndo()
        const p = this.pos(e)
        const ok = this.bucket(p.x, p.y)
        if (!ok) {
          this.undo.pop()
          this.onNote?.('Close the shape first — open ink runs off the page.')
        } else this.onChange?.()
        return
      }
      this.pushUndo()
      this.drawing = true
      c.setPointerCapture(e.pointerId)
      const p = this.pos(e)
      this.lastX = p.x
      this.lastY = p.y
      this.stamp(p.x, p.y)
    })
    c.addEventListener('pointermove', (e) => {
      const p = this.pos(e)
      this.moveCursor(e)
      if (!this.drawing) return
      this.strokeTo(p.x, p.y)
    })
    const end = () => {
      if (!this.drawing) return
      this.drawing = false
      this.onChange?.()
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private moveCursor(e: PointerEvent) {
    if (!this.cursor) return
    const rect = this.canvas.getBoundingClientRect()
    const size = (this.size / this.canvas.width) * rect.width
    this.cursor.style.width = `${Math.max(6, size)}px`
    this.cursor.style.height = `${Math.max(6, size)}px`
    this.cursor.style.left = `${e.clientX}px`
    this.cursor.style.top = `${e.clientY}px`
  }

  attachCursor(el: HTMLElement) {
    this.cursor = el
  }

  private pos(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
    }
  }

  private stamp(x: number, y: number) {
    const g = this.ctx
    g.save()
    if (this.tool === 'erase') {
      g.globalCompositeOperation = 'destination-out'
      g.fillStyle = 'rgba(0,0,0,1)'
    } else {
      g.globalCompositeOperation = 'source-over'
      g.fillStyle = this.color
    }
    g.beginPath()
    g.arc(x, y, this.size * 0.5, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }

  private strokeTo(x: number, y: number) {
    const dx = x - this.lastX
    const dy = y - this.lastY
    const dist = Math.hypot(dx, dy)
    const step = Math.max(1, this.size * 0.22)
    const n = Math.max(1, Math.ceil(dist / step))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      this.stamp(this.lastX + dx * t, this.lastY + dy * t)
    }
    this.lastX = x
    this.lastY = y
  }

  private bucket(x: number, y: number) {
    const w = this.canvas.width
    const h = this.canvas.height
    const sx = Math.floor(x)
    const sy = Math.floor(y)
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return
    const img = this.ctx.getImageData(0, 0, w, h)
    const data = img.data
    const start = sy * w + sx
    const ink = data[start * 4 + 3] > 40
    const seen = new Uint8Array(w * h)
    const stack = new Uint32Array(w * h)
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    const region: number[] = []
    let touches = false
    const [cr, cg, cb] = hexRgb(this.color)
    while (sp) {
      const i = stack[--sp]
      const px = i % w
      const py = (i / w) | 0
      const a = data[i * 4 + 3]
      const isInk = a > 40
      if (ink !== isInk) continue
      region.push(i)
      if (!ink && (px === 0 || py === 0 || px === w - 1 || py === h - 1)) touches = true
      const nb = [i - 1, i + 1, i - w, i + w]
      for (const n of nb) {
        if (n < 0 || n >= w * h || seen[n]) continue
        const nx = n % w
        if (Math.abs(nx - px) > 1) continue
        seen[n] = 1
        stack[sp++] = n
      }
    }
    if (!ink && touches) return false
    for (const i of region) {
      data[i * 4] = cr
      data[i * 4 + 1] = cg
      data[i * 4 + 2] = cb
      data[i * 4 + 3] = 255
    }
    this.ctx.putImageData(img, 0, 0)
    return true
  }
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
