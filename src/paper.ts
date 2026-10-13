export function makePaperCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  if (!g) return c
  g.fillStyle = '#e7dcc6'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(70, 120, 170, 0.35)'
  g.lineWidth = 2
  for (let y = 18; y < 256; y += 22) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(256, y)
    g.stroke()
  }
  g.strokeStyle = 'rgba(196, 64, 48, 0.65)'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(28, 0)
  g.lineTo(28, 256)
  g.stroke()
  const img = g.getImageData(0, 0, 256, 256)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.5))
  }
  g.putImageData(img, 0, 0)
  return c
}

export function makeCheckerCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 32
  const g = c.getContext('2d')
  if (!g) return c
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#16130f' : '#f4ecdc'
      g.fillRect(x * 16, y * 16, 16, 16)
    }
  }
  return c
}
