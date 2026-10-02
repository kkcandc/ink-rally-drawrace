import * as THREE from 'three'
import { clamp } from './format'
import { buildRacer, disposeObject, makeLabel, type RacerArt } from './mesh'
import { makeCheckerCanvas, makePaperCanvas } from './paper'
import {
  placeOf,
  progressOf,
  standings,
  stepSim,
  type GhostFrame,
  type Input,
  type Sim,
  type SimEvent,
  type SimRacer,
} from './sim'
import { frameAt, type BuiltTrack } from './tracks'

export type HudSnap = {
  place: number
  field: number
  lapText: string
  time: number
  lastLap: number | null
  bestLap: number | null
  speed: number
  hot: boolean
  boost: number
  boosting: boolean
  drifting: boolean
  countdown: number
  started: boolean
  finished: boolean
  rows: { name: string; you: boolean; done: boolean; detail: string }[]
}

type Puff = { mesh: THREE.Mesh; life: number; max: number }

export class RaceView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private raf = 0
  private disposed = false
  private paused = false
  private celebrating = false
  private orbit = 0
  private shake = 0
  private look = new THREE.Vector3()
  private camPos = new THREE.Vector3()
  private ready = false
  private groups = new Map<string, { group: THREE.Group; wheels: THREE.Object3D[]; label: THREE.Sprite }>()
  private puffs: Puff[] = []
  private puffGeo = new THREE.SphereGeometry(1, 6, 6)
  private skids: { mesh: THREE.Mesh; life: number }[] = []
  private skidGeo: THREE.PlaneGeometry
  private skidMat: THREE.MeshBasicMaterial
  private lamps: THREE.Mesh[] = []
  private padMats: THREE.MeshBasicMaterial[] = []
  private padSigns: THREE.Sprite[] = []
  private signTex: THREE.CanvasTexture | null = null
  private sun: THREE.DirectionalLight
  private sunTarget = new THREE.Object3D()
  private reduced: boolean
  private recordAcc = 0
  private ghostFrames: GhostFrame[] = []
  private minimap: HTMLCanvasElement | null = null
  private minimapCtx: CanvasRenderingContext2D | null = null
  private fx: HTMLElement | null

  constructor(
    canvas: HTMLCanvasElement,
    private sim: Sim,
    private arts: Map<string, RacerArt>,
    private opts: {
      follow: 'player' | 'leader'
      reducedMotion: boolean
      getInput: () => Input
      onEvent: (e: SimEvent) => void
      onHud: (h: HudSnap) => void
    },
  ) {
    this.reduced = opts.reducedMotion
    this.fx = document.getElementById('fx')
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.setClearColor(0x100e0c, 1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 800)
    this.scene.background = new THREE.Color(0x100e0c)
    this.scene.fog = new THREE.FogExp2(0x100e0c, 0.0052)
    this.skidGeo = new THREE.PlaneGeometry(0.42, 1.05)
    this.skidGeo.rotateX(-Math.PI / 2)
    this.skidMat = new THREE.MeshBasicMaterial({ color: '#1a1612', transparent: true, opacity: 0.45, depthWrite: false })
    this.sun = new THREE.DirectionalLight(0xfff2dc, 1.2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 90
    this.sun.shadow.camera.left = -28
    this.sun.shadow.camera.right = 28
    this.sun.shadow.camera.top = 28
    this.sun.shadow.camera.bottom = -28
    this.scene.add(this.sun)
    this.scene.add(this.sunTarget)
    this.sun.target = this.sunTarget
    this.buildWorld(sim.track)
    this.buildRacers()
    window.addEventListener('resize', this.onResize)
  }

  attachMinimap(canvas: HTMLCanvasElement) {
    this.minimap = canvas
    this.minimapCtx = canvas.getContext('2d')
  }

  start() {
    this.clock.getDelta()
    const loop = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, this.clock.getDelta())
      if (!this.paused) this.tick(dt)
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  setPaused(p: boolean) {
    this.paused = p
    if (!p) this.clock.getDelta()
  }

  celebrate() {
    this.celebrating = true
    this.paused = false
  }

  takeGhost(): GhostFrame[] {
    return this.ghostFrames
  }

  getSim(): Sim {
    return this.sim
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.fx?.classList.remove('boost', 'hit')
    disposeObject(this.scene)
    this.renderer.dispose()
  }

  private onResize = () => {
    if (this.disposed) return
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
  }

  private buildWorld(track: BuiltTrack) {
    const hemi = new THREE.HemisphereLight(0xf0e2c8, 0x140e12, 0.7)
    this.scene.add(hemi)
    this.scene.add(new THREE.AmbientLight(0x2a201c, 0.35))

    let minY = Infinity
    for (const s of track.samples) minY = Math.min(minY, s.y)
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(780, 48),
      new THREE.MeshStandardMaterial({ color: '#14110f', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = minY - 8
    ground.receiveShadow = true
    this.scene.add(ground)

    const paper = new THREE.CanvasTexture(makePaperCanvas())
    paper.colorSpace = THREE.SRGBColorSpace
    paper.wrapS = paper.wrapT = THREE.RepeatWrapping
    paper.anisotropy = 4
    const n = track.samples.length
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (let i = 0; i < n; i++) {
      const s = track.samples[i]
      const half = s.width / 2
      positions.push(
        s.x - s.rx * half,
        s.y - s.ry * half + 0.02,
        s.z - s.rz * half,
        s.x + s.rx * half,
        s.y + s.ry * half + 0.02,
        s.z + s.rz * half,
      )
      const v = s.s / 7
      uvs.push(0, v, 1, v)
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const i0 = i * 2
      const i1 = i0 + 1
      const j0 = j * 2
      const j1 = j0 + 1
      indices.push(i0, j0, i1, i1, j0, j1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    const road = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: paper, roughness: 0.95, metalness: 0 }),
    )
    road.receiveShadow = true
    this.scene.add(road)
    this.scene.add(this.ribbon(track, 0.72, true))
    this.scene.add(this.centerLine(track))
    this.scene.add(this.pads(track))
    this.scene.add(this.finish(track))
    this.lamps = this.gantry(track)
    for (let i = 0; i < 18; i++) {
      const mote = new THREE.Mesh(
        new THREE.SphereGeometry(1.2 + (i % 4) * 0.4, 8, 8),
        new THREE.MeshBasicMaterial({ color: i % 2 ? '#211910' : '#1a1814' }),
      )
      const ang = (i / 18) * Math.PI * 2
      mote.position.set(Math.cos(ang) * (90 + (i % 5) * 30), 8 + (i % 6) * 4, Math.sin(ang) * (70 + (i % 4) * 24))
      this.scene.add(mote)
    }
  }

  private ribbon(track: BuiltTrack, extra: number, curb: boolean): THREE.Mesh {
    const n = track.samples.length
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const verm = new THREE.Color('#ef4b32')
    const cream = new THREE.Color('#f3ead7')
    const ink = new THREE.Color('#1a1612')
    for (let i = 0; i < n; i++) {
      const s = track.samples[i]
      const inner = s.width / 2
      const outer = inner + extra
      const sides = [-1, 1]
      for (const side of sides) {
        positions.push(
          s.x + s.rx * inner * side,
          s.y + s.ry * inner * side + 0.03,
          s.z + s.rz * inner * side,
          s.x + s.rx * outer * side,
          s.y + s.ry * outer * side + 0.03,
          s.z + s.rz * outer * side,
        )
        const alt = Math.floor(s.s / 6) % 2 === 0
        const col = curb ? (alt ? verm : cream) : ink
        colors.push(col.r, col.g, col.b, col.r, col.g, col.b)
      }
    }
    const stride = 4
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      for (let side = 0; side < 2; side++) {
        const a = i * stride + side * 2
        const b = j * stride + side * 2
        indices.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    )
  }

  private centerLine(track: BuiltTrack): THREE.Mesh {
    const positions: number[] = []
    const indices: number[] = []
    const n = track.samples.length
    let v = 0
    for (let i = 0; i < n; i++) {
      const s = track.samples[i]
      if (Math.floor(s.s / 5) % 2 !== 0) continue
      const half = 0.16
      const i0 = v
      positions.push(
        s.x - s.rx * half,
        s.y + 0.06,
        s.z - s.rz * half,
        s.x + s.rx * half,
        s.y + 0.06,
        s.z + s.rz * half,
      )
      v += 2
      const next = track.samples[(i + 1) % n]
      if (Math.floor(next.s / 5) % 2 !== 0) continue
      positions.push(
        next.x - next.rx * half,
        next.y + 0.06,
        next.z - next.rz * half,
        next.x + next.rx * half,
        next.y + 0.06,
        next.z + next.rz * half,
      )
      const j0 = v
      v += 2
      indices.push(i0, j0, i0 + 1, i0 + 1, j0, j0 + 1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setIndex(indices)
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#2a261f' }))
  }

  private pads(track: BuiltTrack): THREE.Group {
    const group = new THREE.Group()
    const n = track.samples.length
    const signTex = this.inkSignTexture()
    const beacon = new THREE.SphereGeometry(0.62, 12, 10)
    let i = 0
    while (i < n) {
      const id = track.samples[i].pad
      if (!id) {
        i++
        continue
      }
      let j = i
      while (j < n && track.samples[j].pad === id) j++
      const positions: number[] = []
      const colors: number[] = []
      const indices: number[] = []
      const lift = 0.28
      const lime = new THREE.Color('#d6ff3a')
      const ink = new THREE.Color('#16130f')
      for (let k = i; k < j; k++) {
        const s = track.samples[k]
        const half = s.width * 0.38
        positions.push(
          s.x - s.rx * half,
          s.y - s.ry * half + s.uy * lift,
          s.z - s.rz * half,
          s.x + s.rx * half,
          s.y + s.ry * half + s.uy * lift,
          s.z + s.rz * half,
        )
        const stripe = Math.floor(s.s / 2.2) % 2 === 0 ? lime : ink
        colors.push(stripe.r, stripe.g, stripe.b, stripe.r, stripe.g, stripe.b)
      }
      const count = j - i
      for (let k = 0; k < count - 1; k++) {
        const a = k * 2
        const b = a + 2
        indices.push(a, b, a + 1, a + 1, b, b + 1)
      }
      if (positions.length > 3) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        geo.setIndex(indices)
        geo.computeVertexNormals()
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
        group.add(new THREE.Mesh(geo, mat))
        const glow = new THREE.MeshBasicMaterial({ color: '#d6ff3a', fog: false })
        this.padMats.push(glow)
        group.add(this.inkGate(track.samples[i], glow))
        for (let k = i; k < j; k += 2) {
          const s = track.samples[k]
          const ball = new THREE.Mesh(beacon, glow)
          ball.position.set(s.x, s.y + s.uy * 1.35, s.z)
          group.add(ball)
        }
        const s0 = track.samples[i]
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, fog: false, transparent: true }))
        sprite.position.set(s0.x + s0.ux * 4.6, s0.y + s0.uy * 4.6, s0.z + s0.uz * 4.6)
        sprite.scale.set(8.4, 4.2, 1)
        this.padSigns.push(sprite)
        group.add(sprite)
      }
      i = j
    }
    return group
  }

  private inkSignTexture(): THREE.CanvasTexture {
    if (this.signTex) return this.signTex
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const g = canvas.getContext('2d')
    if (!g) {
      this.signTex = new THREE.CanvasTexture(canvas)
      return this.signTex
    }
    g.fillStyle = '#14110e'
    g.fillRect(0, 0, 256, 128)
    g.strokeStyle = '#d6ff3a'
    g.lineWidth = 12
    g.strokeRect(8, 8, 240, 112)
    g.fillStyle = '#d6ff3a'
    g.font = '700 78px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('INK', 128, 70)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    this.signTex = tex
    return tex
  }

  private inkGate(s: BuiltTrack['samples'][number], mat: THREE.Material): THREE.Group {
    const gate = new THREE.Group()
    const half = Math.max(2.4, s.width * 0.48)
    const postH = 5.4
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(s.rx, s.ry, s.rz),
      new THREE.Vector3(s.ux, s.uy, s.uz),
      new THREE.Vector3(s.tx, s.ty, s.tz),
    )
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis)
    const post = new THREE.BoxGeometry(0.7, postH, 0.7)
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(post, mat)
      mesh.quaternion.copy(quat)
      mesh.position.set(
        s.x + s.rx * half * side + s.ux * postH * 0.5,
        s.y + s.ry * half * side + s.uy * postH * 0.5,
        s.z + s.rz * half * side + s.uz * postH * 0.5,
      )
      gate.add(mesh)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.62, 0.7), mat)
    lintel.quaternion.copy(quat)
    lintel.position.set(s.x + s.ux * postH, s.y + s.uy * postH, s.z + s.uz * postH)
    gate.add(lintel)
    return gate
  }

  private finish(track: BuiltTrack): THREE.Mesh {
    const f = frameAt(track, 1.2)
    const geo = new THREE.PlaneGeometry(f.width * 0.98, 2.5)
    geo.rotateX(-Math.PI / 2)
    const tex = new THREE.CanvasTexture(makeCheckerCanvas())
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.repeat.set(8, 1)
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 }))
    mesh.position.set(f.x, f.y + 0.09, f.z)
    mesh.rotation.y = Math.atan2(f.tx, f.tz)
    return mesh
  }

  private gantry(track: BuiltTrack): THREE.Mesh[] {
    const f = frameAt(track, track.length - 8)
    const lamps: THREE.Mesh[] = []
    const mat = () =>
      new THREE.MeshStandardMaterial({ color: '#2a2420', emissive: '#3a1010', emissiveIntensity: 0.2 })
    for (let i = -1; i <= 1; i++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 12), mat())
      lamp.position.set(
        f.x + f.rx * i * 2.2 + f.ux * 5.2,
        f.y + f.ry * i * 2.2 + f.uy * 5.2,
        f.z + f.rz * i * 2.2 + f.uz * 5.2,
      )
      this.scene.add(lamp)
      lamps.push(lamp)
    }
    return lamps
  }

  private buildRacers() {
    for (const r of this.sim.racers) {
      const art = this.arts.get(r.id)
      if (!art) continue
      const built = buildRacer(art, r.isGhost)
      const label = makeLabel(r.isGhost ? 'GHOST' : r.name, r.isPlayer)
      label.position.y = art.stats.height + 0.7
      built.group.add(label)
      this.scene.add(built.group)
      this.groups.set(r.id, { ...built, label })
    }
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(
        this.puffGeo,
        new THREE.MeshBasicMaterial({ color: '#d9d0c2', transparent: true, opacity: 0, depthWrite: false }),
      )
      mesh.visible = false
      this.scene.add(mesh)
      this.puffs.push({ mesh, life: 0, max: 1 })
    }
    for (let i = 0; i < 70; i++) {
      const mesh = new THREE.Mesh(this.skidGeo, this.skidMat.clone())
      mesh.visible = false
      this.scene.add(mesh)
      this.skids.push({ mesh, life: 0 })
    }
  }

  private tick(dt: number) {
    const before = this.sim.events.length
    if (!this.celebrating) stepSim(this.sim, dt, () => this.opts.getInput())
    if (this.sim.events.length > before) {
      for (let i = before; i < this.sim.events.length; i++) this.opts.onEvent(this.sim.events[i])
    }
    this.sim.events.length = 0
    this.poseCars(dt)
    this.cameraFrame(dt)
    this.dress(dt)
    this.opts.onHud(this.hud())
    this.paintMinimap()
    const player = this.sim.racers.find((r) => r.isPlayer)
    if (player && this.sim.started && !player.finished) {
      this.recordAcc += dt
      if (this.recordAcc >= 0.1) {
        this.recordAcc = 0
        this.ghostFrames.push({ p: progressOf(player, this.sim.track.length), x: player.x, h: player.heading })
        if (this.ghostFrames.length > 4000) this.ghostFrames.shift()
      }
    }
  }

  private poseCars(dt: number) {
    for (const r of this.sim.racers) {
      const slot = this.groups.get(r.id)
      if (!slot) continue
      const f = frameAt(this.sim.track, r.s, r.x)
      slot.group.position.set(f.x, f.y + 0.02, f.z)
      const up = new THREE.Vector3(f.ux, f.uy, f.uz)
      const fwd = new THREE.Vector3(f.tx, f.ty, f.tz)
      const right = new THREE.Vector3(f.rx, f.ry, f.rz)
      fwd.applyAxisAngle(up, r.heading)
      right.applyAxisAngle(up, r.heading)
      const roll = clamp(-r.vx * 0.045 - r.heading * 0.18, -0.4, 0.4)
      up.applyAxisAngle(fwd, roll)
      right.applyAxisAngle(fwd, roll)
      const basis = new THREE.Matrix4().makeBasis(right, up, fwd)
      slot.group.quaternion.setFromRotationMatrix(basis)
      for (const w of slot.wheels) w.rotateX(-r.v * dt * 1.6)
      if (r.drifting && !this.reduced) this.dropSkid(f, r)
      if ((r.drifting || r.boosting) && !this.reduced) this.puffAt(f, r)
    }
  }

  private dropSkid(f: ReturnType<typeof frameAt>, r: SimRacer) {
    const slot = this.skids.find((s) => s.life <= 0) ?? this.skids[0]
    slot.life = 1
    slot.mesh.visible = true
    slot.mesh.position.set(f.x, f.y + 0.07, f.z)
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(f.rx, f.ry, f.rz),
      new THREE.Vector3(f.ux, f.uy, f.uz),
      new THREE.Vector3(f.tx, f.ty, f.tz),
    )
    slot.mesh.quaternion.setFromRotationMatrix(basis)
    slot.mesh.rotateY(r.heading)
    const mat = slot.mesh.material as THREE.MeshBasicMaterial
    mat.opacity = 0.45
  }

  private puffAt(f: ReturnType<typeof frameAt>, r: SimRacer) {
    const slot = this.puffs.find((p) => p.life <= 0)
    if (!slot) return
    slot.life = slot.max = r.boosting ? 0.45 : 0.7
    slot.mesh.visible = true
    const back = r.boosting ? -1.2 : -0.2
    slot.mesh.position.set(
      f.x - f.tx * back + f.rx * r.x * 0,
      f.y + 0.4,
      f.z - f.tz * back,
    )
    slot.mesh.scale.setScalar(r.boosting ? 0.35 : 0.55)
    const mat = slot.mesh.material as THREE.MeshBasicMaterial
    mat.color.set(r.boosting ? '#d6f25c' : '#d9d0c2')
    mat.opacity = 0.45
  }

  private cameraFrame(dt: number) {
    const target = this.focusRacer()
    if (!target) return
    const f = frameAt(this.sim.track, target.s, target.x * 0.25)
    let desired: THREE.Vector3
    let lookAt: THREE.Vector3
    if (this.celebrating) {
      this.orbit += dt * (this.reduced ? 0.15 : 0.45)
      const swing = this.orbit
      desired = new THREE.Vector3(
        f.x + f.rx * Math.cos(swing) * 7.5 + f.tx * Math.sin(swing) * 6 + f.ux * 3.2,
        f.y + f.ry * Math.cos(swing) * 7.5 + f.ty * Math.sin(swing) * 6 + f.uy * 3.2,
        f.z + f.rz * Math.cos(swing) * 7.5 + f.tz * Math.sin(swing) * 6 + f.uz * 3.2,
      )
      lookAt = new THREE.Vector3(f.x, f.y + 1.1, f.z)
    } else {
      const back = frameAt(this.sim.track, target.s - 8.5, target.x * 0.15)
      const ahead = frameAt(this.sim.track, target.s + 10, target.x * 0.05)
      desired = new THREE.Vector3(
        back.x + back.ux * 4.3 + back.rx * 6.4,
        back.y + back.uy * 4.3 + back.ry * 6.4,
        back.z + back.uz * 4.3 + back.rz * 6.4,
      )
      lookAt = new THREE.Vector3(ahead.x, ahead.y + 1.3, ahead.z)
    }
    if (!this.ready) {
      this.camPos.copy(desired)
      this.look.copy(lookAt)
      this.ready = true
    } else {
      const k = 1 - Math.exp(-3.4 * dt)
      this.camPos.lerp(desired, k)
      this.look.lerp(lookAt, k)
    }
    if (target.scraping && !this.reduced) this.shake = Math.min(0.35, this.shake + 0.12)
    this.shake *= Math.exp(-3.5 * dt)
    this.camera.position.copy(this.camPos)
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6
    }
    this.camera.lookAt(this.look)
    const fov = 56 + clamp(target.v / 30, 0, 1) * 8 + (target.boosting ? 6 : 0)
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4)
    this.camera.updateProjectionMatrix()
    this.sun.position.set(f.x + 24, f.y + 36, f.z + 12)
    this.sunTarget.position.set(f.x, f.y, f.z)
    this.fx?.classList.toggle('boost', !!target.boosting && target.isPlayer)
    this.fx?.classList.toggle('hit', target.scraping && target.isPlayer)
  }

  private focusRacer(): SimRacer | undefined {
    if (this.opts.follow === 'player') return this.sim.racers.find((r) => r.isPlayer) ?? this.sim.racers[0]
    return standings(this.sim)[0] ?? this.sim.racers[0]
  }

  private dress(dt: number) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue
      p.life -= dt
      p.mesh.position.y += dt * 1.4
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, (p.life / p.max) * 0.5)
      p.mesh.scale.multiplyScalar(1 + dt * 0.8)
      if (p.life <= 0) p.mesh.visible = false
    }
    for (const s of this.skids) {
      if (s.life <= 0) continue
      s.life -= dt * 0.22
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, s.life * 0.4)
      if (s.life <= 0) s.mesh.visible = false
    }
    const c = this.sim.countdown
    const lit = !this.sim.started ? (c > 2 ? 0 : c > 1 ? 1 : c > 0 ? 2 : 3) : 3
    const pulse = 0.82 + Math.sin(this.sim.time * 7) * 0.18
    for (const mat of this.padMats) mat.color.setRGB(0.84 * pulse, 1 * pulse, 0.23 * pulse)
    for (const sign of this.padSigns) sign.scale.set(8.4 * pulse, 4.2 * pulse, 1)
    this.lamps.forEach((lamp, i) => {
      const mat = lamp.material as THREE.MeshStandardMaterial
      const on = this.sim.started ? true : i < lit
      mat.emissive.set(this.sim.started ? '#d6f25c' : '#ef4b32')
      mat.emissiveIntensity = on ? (this.sim.started ? 1.1 : 0.9) : 0.05
    })
  }

  private hud(): HudSnap {
    const player = this.sim.racers.find((r) => r.isPlayer)
    const rows = standings(this.sim)
    const field = rows.length
    const place = player ? placeOf(this.sim, player.id) : 1
    const lap = player ? Math.min(this.sim.laps, player.lapsDone + 1) : 1
    return {
      place,
      field,
      lapText: player?.finished ? 'FIN' : `${lap}/${this.sim.laps}`,
      time: player?.finishTime ?? this.sim.time,
      lastLap: player?.lastLap ?? null,
      bestLap: player?.bestLap ?? null,
      speed: Math.round((player?.v ?? 0) * 8),
      hot: !!player?.hot,
      boost: player?.boost ?? 0,
      boosting: !!player?.boosting,
      drifting: !!player?.drifting,
      countdown: this.sim.started ? 0 : this.sim.countdown,
      started: this.sim.started,
      finished: !!player?.finished,
      rows: rows.slice(0, 6).map((r) => ({
        name: r.name,
        you: r.isPlayer,
        done: r.finished,
        detail: r.finished ? 'IN' : `L${Math.min(this.sim.laps, r.lapsDone + 1)}`,
      })),
    }
  }

  private paintMinimap() {
    const ctx = this.minimapCtx
    const canvas = this.minimap
    if (!ctx || !canvas) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const samples = this.sim.track.samples
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const s of samples) {
      minX = Math.min(minX, s.x)
      maxX = Math.max(maxX, s.x)
      minZ = Math.min(minZ, s.z)
      maxZ = Math.max(maxZ, s.z)
    }
    const pad = 12
    const sx = (maxX - minX) || 1
    const sz = (maxZ - minZ) || 1
    const project = (x: number, z: number) => ({
      x: pad + ((x - minX) / sx) * (w - pad * 2),
      y: pad + ((z - minZ) / sz) * (h - pad * 2),
    })
    ctx.beginPath()
    samples.forEach((s, i) => {
      const p = project(s.x, s.z)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.strokeStyle = 'rgba(243,234,215,0.85)'
    ctx.lineWidth = 3
    ctx.stroke()
    const seen = new Set<number>()
    for (const s of samples) {
      if (!s.pad || seen.has(s.pad)) continue
      seen.add(s.pad)
      const p = project(s.x, s.z)
      ctx.beginPath()
      ctx.fillStyle = '#d6ff3a'
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#14110e'
      ctx.stroke()
    }
    for (const r of this.sim.racers) {
      const f = frameAt(this.sim.track, r.s, r.x)
      const p = project(f.x, f.z)
      ctx.beginPath()
      ctx.fillStyle = r.isGhost ? 'rgba(214,242,92,0.45)' : r.isPlayer ? '#d6f25c' : r.color
      ctx.arc(p.x, p.y, r.isPlayer ? 4.5 : 3.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
