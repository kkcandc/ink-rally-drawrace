import * as THREE from 'three'
import { buildRacer, disposeObject, type RacerArt } from './mesh'

export class Portrait {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private raf = 0
  private group: THREE.Group
  private disposed = false

  constructor(canvas: HTMLCanvasElement, art: RacerArt) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40)
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x241810, 1.05))
    const key = new THREE.DirectionalLight(0xfff8ee, 1.35)
    key.position.set(4, 6, 3)
    this.scene.add(key)
    const built = buildRacer(art)
    this.group = built.group
    this.scene.add(this.group)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 40),
      new THREE.MeshStandardMaterial({ color: '#e7dcc6', roughness: 0.92 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.01
    this.scene.add(floor)
    const dist = Math.max(art.stats.length, art.stats.height) * 1.55 + 2.4
    this.camera.position.set(dist * 0.9, art.stats.height * 0.62 + 0.7, dist * 0.35)
    this.camera.lookAt(0, art.stats.height * 0.42, 0)
    this.resize()
    const loop = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)
      this.group.rotation.y += 0.007
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  resize() {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || 480
    const h = canvas.clientHeight || 360
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    disposeObject(this.scene)
    this.renderer.dispose()
  }
}
