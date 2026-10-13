import * as THREE from 'three'
import { hazardX, type Hazard } from './hazards'
import { frameAt, type BuiltTrack } from './tracks'

export type HazardActor = {
  hazard: Hazard
  group: THREE.Group
  spin: THREE.Object3D | null
}

const WORDS = ['SKETCH', 'SEND', 'SMEAR']

function bannerTexture(word: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#16130f'
    g.fillRect(0, 0, 512, 128)
    g.fillStyle = word === 'SEND' ? '#d6f25c' : word === 'SMEAR' ? '#ef4b32' : '#f3ead7'
    g.fillRect(0, 0, 18, 128)
    g.fillRect(494, 0, 18, 128)
    g.font = '700 78px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(word, 256, 68)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function basisAt(track: BuiltTrack, s: number, lateral = 0): { f: ReturnType<typeof frameAt>; quat: THREE.Quaternion } {
  const f = frameAt(track, s, lateral)
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(f.rx, f.ry, f.rz),
      new THREE.Vector3(f.ux, f.uy, f.uz),
      new THREE.Vector3(f.tx, f.ty, f.tz),
    ),
  )
  return { f, quat }
}

function setBasis(obj: THREE.Object3D, f: ReturnType<typeof frameAt>, quat: THREE.Quaternion, yLift: number) {
  obj.position.set(f.x + f.ux * yLift, f.y + f.uy * yLift, f.z + f.uz * yLift)
  obj.quaternion.copy(quat)
}

export function addStands(scene: THREE.Scene, track: BuiltTrack) {
  const n = track.samples.length
  const step = Math.max(1, Math.round(24 / track.spacing))
  const spots: { i: number; side: number }[] = []
  for (let i = 0; i < n; i += step) {
    spots.push({ i, side: -1 }, { i, side: 1 })
  }
  const sections = spots.length
  const tiers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(9.2, 0.62, 2.15),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.86, metalness: 0.02 }),
    sections * 4,
  )
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(9.4, 6.4, 0.45),
    new THREE.MeshStandardMaterial({ color: '#3a322c', roughness: 0.9 }),
    sections,
  )
  const fascias = new THREE.InstancedMesh(
    new THREE.BoxGeometry(9.2, 0.38, 0.28),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, emissive: '#ffffff', emissiveIntensity: 0.18 }),
    sections,
  )
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.42, 0.62, 0.32),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }),
    sections * 5,
  )
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.28, 0.28, 0.26),
    new THREE.MeshStandardMaterial({ color: '#f3ead7', roughness: 0.72 }),
    sections * 5,
  )
  const banners = WORDS.map(
    (word) =>
      new THREE.InstancedMesh(
        new THREE.PlaneGeometry(6.4, 1.35),
        new THREE.MeshBasicMaterial({ map: bannerTexture(word), side: THREE.DoubleSide, toneMapped: false }),
        Math.ceil(sections / WORDS.length) + 1,
      ),
  )
  const bannerCounts = [0, 0, 0]
  const dummy = new THREE.Object3D()
  const palette = ['#d6f25c', '#ef4b32', '#f3ead7', '#147a86', '#e0a33a', '#d43378']
  let tierI = 0
  let wallI = 0
  let fasciaI = 0
  let crowdI = 0

  spots.forEach((spot, section) => {
    const sample = track.samples[spot.i]
    const side = spot.side
    const out = sample.width * 0.5 + 8.4
    const anchor = frameAt(track, sample.s, out * side)
    const quat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(anchor.tx, anchor.ty, anchor.tz),
        new THREE.Vector3(anchor.ux, anchor.uy, anchor.uz),
        new THREE.Vector3(anchor.rx * side, anchor.ry * side, anchor.rz * side),
      ),
    )
    for (let t = 0; t < 4; t++) {
      dummy.position.set(
        anchor.x + anchor.rx * side * (t * 1.15) + anchor.ux * (0.7 + t * 0.72),
        anchor.y + anchor.ry * side * (t * 1.15) + anchor.uy * (0.7 + t * 0.72),
        anchor.z + anchor.rz * side * (t * 1.15) + anchor.uz * (0.7 + t * 0.72),
      )
      dummy.quaternion.copy(quat)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      tiers.setMatrixAt(tierI, dummy.matrix)
      const seat = t % 2 === 0 ? new THREE.Color('#efe4cf') : new THREE.Color('#d7cbb6')
      tiers.setColorAt(tierI, seat)
      tierI++
    }
    dummy.position.set(
      anchor.x + anchor.rx * side * 4.6 + anchor.ux * 3.3,
      anchor.y + anchor.ry * side * 4.6 + anchor.uy * 3.3,
      anchor.z + anchor.rz * side * 4.6 + anchor.uz * 3.3,
    )
    dummy.quaternion.copy(quat)
    dummy.updateMatrix()
    walls.setMatrixAt(wallI, dummy.matrix)
    wallI++

    dummy.position.set(
      anchor.x + anchor.rx * side * 0.15 + anchor.ux * 2.15,
      anchor.y + anchor.ry * side * 0.15 + anchor.uy * 2.15,
      anchor.z + anchor.rz * side * 0.15 + anchor.uz * 2.15,
    )
    dummy.updateMatrix()
    fascias.setMatrixAt(fasciaI, dummy.matrix)
    fascias.setColorAt(fasciaI, new THREE.Color(section % 2 === 0 ? '#ef4b32' : '#d6f25c'))
    fasciaI++

    for (let p = 0; p < 5; p++) {
      const along = (p - 2) * 1.45
      const row = p % 2
      const px = anchor.x + anchor.tx * along + anchor.rx * side * (1.2 + row * 0.85) + anchor.ux * (2.15 + row * 0.55)
      const py = anchor.y + anchor.ty * along + anchor.ry * side * (1.2 + row * 0.85) + anchor.uy * (2.15 + row * 0.55)
      const pz = anchor.z + anchor.tz * along + anchor.rz * side * (1.2 + row * 0.85) + anchor.uz * (2.15 + row * 0.55)
      dummy.position.set(px, py, pz)
      dummy.quaternion.copy(quat)
      dummy.scale.set(1, 0.85 + (p % 3) * 0.12, 1)
      dummy.updateMatrix()
      bodies.setMatrixAt(crowdI, dummy.matrix)
      bodies.setColorAt(crowdI, new THREE.Color(palette[(section + p) % palette.length]))
      dummy.position.set(px + anchor.ux * 0.48, py + anchor.uy * 0.48, pz + anchor.uz * 0.48)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      heads.setMatrixAt(crowdI, dummy.matrix)
      crowdI++
    }

    if (section % 2 === 0) {
      const word = section % WORDS.length
      const mesh = banners[word]
      dummy.position.set(
        anchor.x + anchor.rx * side * 4.9 + anchor.ux * 6.5,
        anchor.y + anchor.ry * side * 4.9 + anchor.uy * 6.5,
        anchor.z + anchor.rz * side * 4.9 + anchor.uz * 6.5,
      )
      dummy.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(anchor.tx, anchor.ty, anchor.tz),
          new THREE.Vector3(anchor.ux, anchor.uy, anchor.uz),
          new THREE.Vector3(-anchor.rx * side, -anchor.ry * side, -anchor.rz * side),
        ),
      )
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(bannerCounts[word], dummy.matrix)
      bannerCounts[word]++
    }
  })

  tiers.count = tierI
  walls.count = wallI
  fascias.count = fasciaI
  bodies.count = crowdI
  heads.count = crowdI
  if (tiers.instanceColor) tiers.instanceColor.needsUpdate = true
  if (fascias.instanceColor) fascias.instanceColor.needsUpdate = true
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
  for (const mesh of [tiers, walls, fascias, bodies, heads]) {
    mesh.castShadow = false
    mesh.receiveShadow = false
    scene.add(mesh)
  }
  banners.forEach((mesh, i) => {
    mesh.count = bannerCounts[i]
    if (bannerCounts[i] > 0) scene.add(mesh)
  })
}

function labelSprite(text: string, ink: string, paper: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = ink
    g.fillRect(8, 10, 240, 76)
    g.strokeStyle = paper
    g.lineWidth = 6
    g.strokeRect(8, 10, 240, 76)
    g.fillStyle = paper
    g.font = '700 42px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 128, 50)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sprite.scale.set(4.6, 1.7, 1)
  sprite.position.y = 2.4
  return sprite
}

export function addHazardActors(scene: THREE.Scene, track: BuiltTrack): HazardActor[] {
  const actors: HazardActor[] = []
  for (const hazard of track.hazards) {
    const group = new THREE.Group()
    let spin: THREE.Object3D | null = null
    if (hazard.kind === 'slick') {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(hazard.lateral * 2, 0.08, hazard.along * 2),
        new THREE.MeshStandardMaterial({
          color: '#24143f',
          emissive: '#7a4dff',
          emissiveIntensity: 0.55,
          roughness: 0.18,
          metalness: 0.08,
        }),
      )
      group.add(pad)
      const gleam = new THREE.Mesh(
        new THREE.BoxGeometry(hazard.lateral * 1.1, 0.1, hazard.along * 0.55),
        new THREE.MeshBasicMaterial({ color: '#d6c2ff' }),
      )
      gleam.position.y = 0.05
      group.add(gleam)
      group.add(labelSprite('SLICK', '#24143f', '#d6c2ff'))
    } else if (hazard.kind === 'sticky') {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(hazard.lateral * 2, 0.1, hazard.along * 2),
        new THREE.MeshStandardMaterial({
          color: '#8a3b12',
          emissive: '#ff7a2a',
          emissiveIntensity: 0.35,
          roughness: 0.92,
        }),
      )
      group.add(pad)
      const blob = new THREE.SphereGeometry(0.55, 10, 8)
      const mat = new THREE.MeshStandardMaterial({ color: '#e07a28', roughness: 0.4, emissive: '#ff9442', emissiveIntensity: 0.2 })
      for (const [x, z] of [
        [-0.6, -0.8],
        [0.7, 0.2],
        [0, 1.1],
      ] as const) {
        const mesh = new THREE.Mesh(blob, mat)
        mesh.position.set(x, 0.28, z)
        mesh.scale.set(1, 0.45, 1)
        group.add(mesh)
      }
      group.add(labelSprite('STUCK', '#3a1608', '#ffb07a'))
    } else if (hazard.kind === 'cone') {
      const cone = new THREE.ConeGeometry(0.42, 1.05, 8)
      const mat = new THREE.MeshStandardMaterial({ color: '#ef4b32', roughness: 0.45, emissive: '#ef4b32', emissiveIntensity: 0.15 })
      const band = new THREE.MeshStandardMaterial({ color: '#f3ead7', roughness: 0.5 })
      for (const [x, z] of [
        [-0.7, -0.8],
        [0.75, 0],
        [-0.15, 0.9],
      ] as const) {
        const mesh = new THREE.Mesh(cone, mat)
        mesh.position.set(x, 0.52, z)
        group.add(mesh)
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.12, 8), band)
        stripe.position.set(x, 0.42, z)
        group.add(stripe)
      }
      group.add(labelSprite('CONE', '#ef4b32', '#16130f'))
    } else {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 1.15, 1.35),
        new THREE.MeshStandardMaterial({ color: '#1c1915', roughness: 0.4, metalness: 0.2, emissive: '#d6f25c', emissiveIntensity: 0.18 }),
      )
      body.position.y = 0.85
      group.add(body)
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 2.7, 12),
        new THREE.MeshStandardMaterial({ color: '#d6f25c', emissive: '#d6f25c', emissiveIntensity: 0.45, roughness: 0.35 }),
      )
      roller.rotation.z = Math.PI / 2
      roller.position.y = 0.42
      group.add(roller)
      spin = roller
      const mast = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 1.5, 0.16),
        new THREE.MeshStandardMaterial({ color: '#f3ead7' }),
      )
      mast.position.y = 1.9
      group.add(mast)
      group.add(labelSprite('SWEEP', '#d6f25c', '#16130f'))
    }
    const { f, quat } = basisAt(track, hazard.s, hazardX(hazard, 0))
    setBasis(group, f, quat, 0.12)
    scene.add(group)
    actors.push({ hazard, group, spin })
  }
  return actors
}

export function syncHazards(actors: HazardActor[], track: BuiltTrack, time: number, dt: number) {
  for (const actor of actors) {
    const x = hazardX(actor.hazard, time)
    const { f, quat } = basisAt(track, actor.hazard.s, x)
    setBasis(actor.group, f, quat, 0.12)
    if (actor.spin) actor.spin.rotateX(dt * 4.5)
  }
}
