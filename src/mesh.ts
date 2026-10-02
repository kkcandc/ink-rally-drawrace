import * as THREE from 'three'
import type { InkMask, RuntimeStats } from './ink'

export type RacerArt = {
  mask: InkMask
  sprite: HTMLCanvasElement
  stats: RuntimeStats
}

export type RacerMesh = {
  group: THREE.Group
  wheels: THREE.Object3D[]
}

function cropSprite(sprite: HTMLCanvasElement, art: RacerArt): HTMLCanvasElement {
  const { mask, stats } = art
  const { minX, minY, maxX, maxY } = stats.bbox
  const bw = Math.max(1, maxX - minX + 1)
  const bh = Math.max(1, maxY - minY + 1)
  const padX = bw * 0.04
  const padY = bh * 0.06
  const u0 = Math.max(0, (minX - padX) / mask.w)
  const v0 = Math.max(0, (minY - padY) / mask.h)
  const u1 = Math.min(1, (maxX + 1 + padX) / mask.w)
  const v1 = Math.min(1, (maxY + 1 + padY) / mask.h)
  const sx = u0 * sprite.width
  const sy = v0 * sprite.height
  const sw = Math.max(2, (u1 - u0) * sprite.width)
  const sh = Math.max(2, (v1 - v0) * sprite.height)
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.round(sw))
  c.height = Math.max(2, Math.round(sh))
  const g = c.getContext('2d')
  if (!g) return sprite
  g.drawImage(sprite, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return c
}

function halo(src: HTMLCanvasElement): HTMLCanvasElement {
  const m = Math.max(6, Math.round(src.width * 0.012))
  const c = document.createElement('canvas')
  c.width = src.width + m * 2
  c.height = src.height + m * 2
  const g = c.getContext('2d')
  if (!g) return src
  const offsets = [
    [-m, 0],
    [m, 0],
    [0, -m],
    [0, m],
    [-m * 0.7, -m * 0.7],
    [m * 0.7, -m * 0.7],
    [-m * 0.7, m * 0.7],
    [m * 0.7, m * 0.7],
  ]
  for (const [dx, dy] of offsets) g.drawImage(src, m + dx, m + dy)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = '#f4ecdc'
  g.fillRect(0, 0, c.width, c.height)
  g.globalCompositeOperation = 'source-over'
  g.drawImage(src, m, m)
  return c
}

function wheelZs(art: RacerArt): number[] {
  const { mask, stats } = art
  const { minX, maxX, minY, maxY } = stats.bbox
  const bw = Math.max(1, maxX - minX + 1)
  const find = (x0: number, x1: number) => {
    let sx = 0
    let n = 0
    const yStart = Math.floor(minY + (maxY - minY) * 0.45)
    for (let y = maxY; y >= yStart; y--) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        if (x < 0 || x >= mask.w || y < 0 || y >= mask.h) continue
        if (mask.bits[y * mask.w + x]) {
          sx += x
          n++
        }
      }
      if (n > 6) break
    }
    if (!n) return null
    return ((sx / n - minX) / bw - 0.5) * stats.length
  }
  const rear = find(minX, minX + bw * 0.38)
  const front = find(minX + bw * 0.62, maxX)
  const zs = [rear, front].filter((v): v is number => v != null)
  return zs.length ? zs : [-stats.length * 0.28, stats.length * 0.3]
}

export function buildRacer(art: RacerArt, ghost = false): RacerMesh {
  const { stats } = art
  const group = new THREE.Group()
  const painted = halo(cropSprite(art.sprite, art))
  const tex = new THREE.CanvasTexture(painted)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.78,
    metalness: 0.02,
    transparent: true,
    alphaTest: ghost ? 0 : 0.28,
    opacity: ghost ? 0.38 : 1,
    side: THREE.DoubleSide,
    depthWrite: !ghost,
  })
  const geo = new THREE.PlaneGeometry(stats.length, stats.height)
  // Nose (texture +X) swings onto +Z. Normal lands on +X, toward the chase camera.
  geo.rotateY(Math.PI / 2)
  geo.scale(1, 1, -1)
  const card = new THREE.Mesh(geo, mat)
  card.castShadow = !ghost
  card.position.y = stats.height * 0.5
  group.add(card)

  const backMat = mat.clone()
  backMat.color = new THREE.Color(art.mask.color).multiplyScalar(0.45)
  const back = new THREE.Mesh(geo, backMat)
  back.position.set(-0.12, stats.height * 0.5, 0)
  back.castShadow = !ghost
  group.add(back)

  const wheels: THREE.Object3D[] = []
  const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#14110e', roughness: 0.55 })
  for (const z of wheelZs(art)) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.position.set(0.16, 0.2, z)
    w.castShadow = !ghost
    group.add(w)
    wheels.push(w)
  }

  const lamp = new THREE.SphereGeometry(0.09, 10, 10)
  const nose = new THREE.Mesh(
    lamp,
    new THREE.MeshStandardMaterial({
      color: '#d6f25c',
      emissive: '#d6f25c',
      emissiveIntensity: ghost ? 0.2 : 0.85,
    }),
  )
  nose.position.set(0.05, stats.height * 0.55, stats.length * 0.48)
  group.add(nose)
  const tail = new THREE.Mesh(
    lamp,
    new THREE.MeshStandardMaterial({
      color: '#ef4b32',
      emissive: '#ef4b32',
      emissiveIntensity: ghost ? 0.25 : 1,
    }),
  )
  tail.position.set(0.05, stats.height * 0.42, -stats.length * 0.46)
  group.add(tail)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(0.8, stats.length * 0.34), 18),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: ghost ? 0.12 : 0.28, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.04
  group.add(shadow)

  return { group, wheels }
}

export function makeLabel(name: string, you: boolean): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const g = c.getContext('2d')
  if (g) {
    g.clearRect(0, 0, 512, 128)
    g.fillStyle = you ? 'rgba(214,242,92,0.92)' : 'rgba(243,234,215,0.88)'
    g.fillRect(16, 28, 480, 72)
    g.fillStyle = '#16130f'
    g.font = '600 54px Outfit, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(name.slice(0, 18), 256, 64)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(3.1, 0.78, 1)
  return sprite
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    const mats = material ? (Array.isArray(material) ? material : [material]) : []
    for (const mat of mats) {
      const mapped = mat as THREE.MeshStandardMaterial
      if (mapped.map) mapped.map.dispose()
      mat.dispose()
    }
  })
}
