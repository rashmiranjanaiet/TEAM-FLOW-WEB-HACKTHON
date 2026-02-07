import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const PLANETS = [
  { name: 'Mercury', a: 0.39, periodDays: 88, color: 0xb7b7b7, size: 0.5 },
  { name: 'Venus', a: 0.72, periodDays: 225, color: 0xd9b27f, size: 0.75 },
  { name: 'Earth', a: 1.0, periodDays: 365.25, color: 0x3d86ff, size: 0.85 },
  { name: 'Mars', a: 1.52, periodDays: 687, color: 0xc76e5d, size: 0.68 },
]

const AU_SCALE = 42
const FRAME_MS = 33

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function degToRad(v) {
  return (v || 0) * (Math.PI / 180)
}

function solveEccentricAnomaly(M, e) {
  let E = M
  for (let i = 0; i < 7; i += 1) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  }
  return E
}

function keplerPosition(elements, timeDays) {
  const a = elements.semi_major_axis_au
  const e = elements.eccentricity
  const i = degToRad(elements.inclination_deg)
  const omega = degToRad(elements.perihelion_argument_deg)
  const Omega = degToRad(elements.ascending_node_longitude_deg)
  const M0 = degToRad(elements.mean_anomaly_deg)

  if (!a || e == null) return new THREE.Vector3(0, 0, 0)

  const meanMotion = elements.mean_motion_deg_per_day
    ? degToRad(elements.mean_motion_deg_per_day)
    : degToRad(0.9856076686 / Math.pow(a, 1.5))

  const M = M0 + meanMotion * timeDays
  const E = solveEccentricAnomaly(M, e)

  const xOrb = a * (Math.cos(E) - e)
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E)

  const cosO = Math.cos(Omega)
  const sinO = Math.sin(Omega)
  const cosI = Math.cos(i)
  const sinI = Math.sin(i)
  const cosW = Math.cos(omega)
  const sinW = Math.sin(omega)

  const x = (cosO * cosW - sinO * sinW * cosI) * xOrb + (-cosO * sinW - sinO * cosW * cosI) * yOrb
  const y = (sinO * cosW + cosO * sinW * cosI) * xOrb + (-sinO * sinW + cosO * cosW * cosI) * yOrb
  const z = (sinW * sinI) * xOrb + (cosW * sinI) * yOrb

  return new THREE.Vector3(x * AU_SCALE, z * AU_SCALE, y * AU_SCALE)
}

function makeLabelTexture(text, color = '#d9ecff') {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 80
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(10,20,35,0.72)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = color
  ctx.font = 'bold 28px Segoe UI'
  ctx.fillText(text, 12, 50)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function RealOrbitViewer({ items, selectedAsteroidId }) {
  const mountRef = useRef(null)
  const frameRef = useRef(0)
  const viewModeRef = useRef('solar')
  const playRef = useRef(true)
  const speedRef = useRef(12)
  const progressRef = useRef(0)
  const targetProgressRef = useRef(0)

  const [viewMode, setViewMode] = useState('solar')
  const [isPlaying, setIsPlaying] = useState(true)
  const [speed, setSpeed] = useState(12)
  const [slider, setSlider] = useState(0)
  const [orbitData, setOrbitData] = useState([])

  const selectedId = selectedAsteroidId || items?.[0]?.id
  const idsToFetch = useMemo(() => {
    const top = (items || []).slice(0, 8).map((x) => x.id)
    if (selectedId && !top.includes(selectedId)) top.unshift(selectedId)
    return top.filter(Boolean)
  }, [items, selectedId])

  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])

  useEffect(() => {
    playRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    targetProgressRef.current = slider / 100
  }, [slider])

  useEffect(() => {
    let cancelled = false
    async function loadOrbits() {
      const reqs = idsToFetch.map(async (id) => {
        try {
          const res = await fetch(`${API_BASE}/lookup/${id}`)
          if (!res.ok) return null
          const data = await res.json()
          const item = data?.item
          if (!item?.orbital_elements?.semi_major_axis_au) return null
          return {
            id,
            name: item.name,
            risk_category: item.risk_category,
            risk_score: item.risk_score,
            orbital_elements: item.orbital_elements,
          }
        } catch {
          return null
        }
      })
      const rows = (await Promise.all(reqs)).filter(Boolean)
      if (!cancelled) setOrbitData(rows)
    }
    if (idsToFetch.length > 0) loadOrbits()
    return () => {
      cancelled = true
    }
  }, [idsToFetch])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x01040a)

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000)
    camera.position.set(0, 150, 220)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.innerHTML = ''
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 20
    controls.maxDistance = 1200

    const ambient = new THREE.AmbientLight(0x54719e, 0.28)
    scene.add(ambient)

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.35)
    sunLight.position.set(240, 120, 60)
    scene.add(sunLight)

    const starsGeo = new THREE.BufferGeometry()
    const starsCount = 2000
    const stars = new Float32Array(starsCount * 3)
    for (let i = 0; i < starsCount; i += 1) {
      stars[i * 3] = (Math.random() - 0.5) * 2400
      stars[i * 3 + 1] = (Math.random() - 0.5) * 1600
      stars[i * 3 + 2] = (Math.random() - 0.5) * 2400
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3))
    const starsMat = new THREE.PointsMaterial({ color: 0xb9d6ff, size: 1.3, transparent: true, opacity: 0.75 })
    const starPoints = new THREE.Points(starsGeo, starsMat)
    scene.add(starPoints)

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(5.8, 28, 28),
      new THREE.MeshBasicMaterial({ color: 0xffcf72 })
    )
    scene.add(sun)

    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(8.8, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffa233, transparent: true, opacity: 0.18 })
    )
    scene.add(sunGlow)

    const planetGroup = new THREE.Group()
    const orbitGroup = new THREE.Group()
    const asteroidGroup = new THREE.Group()
    scene.add(orbitGroup)
    scene.add(planetGroup)
    scene.add(asteroidGroup)

    const earthLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture('Earth') }))
    earthLabel.scale.set(22, 7, 1)
    planetGroup.add(earthLabel)

    const planetMeshes = PLANETS.map((p) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(p.size, 18, 18),
        new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.65, metalness: 0.02 })
      )
      planetGroup.add(mesh)

      const points = []
      for (let i = 0; i <= 220; i += 1) {
        const t = (i / 220) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(t) * p.a * AU_SCALE, 0, Math.sin(t) * p.a * AU_SCALE))
      }
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x6e8fb8, transparent: true, opacity: 0.26 })
      )
      orbitGroup.add(line)
      return { ...p, mesh }
    })

    const asteroidObjects = []

    function rebuildAsteroids(data) {
      asteroidObjects.forEach((obj) => {
        obj.mesh.geometry.dispose()
        obj.mesh.material.dispose()
        obj.line.geometry.dispose()
        obj.line.material.dispose()
        if (obj.label) {
          obj.label.material.map.dispose()
          obj.label.material.dispose()
        }
        asteroidGroup.remove(obj.mesh)
        orbitGroup.remove(obj.line)
        if (obj.label) asteroidGroup.remove(obj.label)
      })
      asteroidObjects.length = 0

      data.forEach((a) => {
        const risk = a.risk_category || 'Low'
        const color = risk === 'High' ? 0xff6d6d : risk === 'Medium' ? 0xffc470 : 0x63e2ad
        const mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.5, 0),
          new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.02 })
        )
        asteroidGroup.add(mesh)

        const orbitPts = []
        for (let i = 0; i <= 280; i += 1) {
          const d = (i / 280) * 365
          orbitPts.push(keplerPosition(a.orbital_elements, d))
        }
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(orbitPts),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 })
        )
        orbitGroup.add(line)

        const isSelected = a.id === selectedId
        const label = isSelected
          ? new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`${a.name} (${risk})`, '#ffd8d8') }))
          : null
        if (label) {
          label.scale.set(36, 9, 1)
          asteroidGroup.add(label)
        }

        asteroidObjects.push({ ...a, mesh, line, label })
      })
    }

    rebuildAsteroids(orbitData)

    const onResize = () => {
      const w = mount.clientWidth
      const h = Math.max(1, mount.clientHeight)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)
    onResize()

    const earthState = { pos: new THREE.Vector3() }
    let lastMs = 0
    let lastUiUpdate = 0

    const animate = (ms) => {
      frameRef.current = requestAnimationFrame(animate)
      if (ms - lastMs < FRAME_MS) return
      const dt = lastMs ? (ms - lastMs) / 1000 : 0
      lastMs = ms

      if (playRef.current) {
        targetProgressRef.current = (targetProgressRef.current + dt * (speedRef.current / 365)) % 1
      }
      progressRef.current += (targetProgressRef.current - progressRef.current) * 0.08

      const simDays = progressRef.current * 365
      if (ms - lastUiUpdate > 220 && playRef.current) {
        lastUiUpdate = ms
        setSlider(Math.round(progressRef.current * 1000) / 10)
      }

      planetMeshes.forEach((p) => {
        const theta = (simDays / p.periodDays) * Math.PI * 2
        p.mesh.position.set(Math.cos(theta) * p.a * AU_SCALE, 0, Math.sin(theta) * p.a * AU_SCALE)
        p.mesh.rotation.y += dt * 0.5
        if (p.name === 'Earth') {
          earthState.pos.copy(p.mesh.position)
          earthLabel.position.copy(p.mesh.position.clone().add(new THREE.Vector3(0, 4.5, 0)))
        }
      })

      asteroidObjects.forEach((a) => {
        const pos = keplerPosition(a.orbital_elements, simDays)
        a.mesh.position.copy(pos)
        a.mesh.rotation.x += dt * 0.6
        a.mesh.rotation.y += dt * 0.4
        if (a.label) a.label.position.copy(pos.clone().add(new THREE.Vector3(0, 4, 0)))
      })

      const selectedObj = asteroidObjects.find((x) => x.id === selectedId)
      const mode = viewModeRef.current
      const camTarget = new THREE.Vector3()
      const camPos = new THREE.Vector3()

      if (mode === 'earth') {
        camTarget.copy(earthState.pos)
        camPos.copy(earthState.pos.clone().add(new THREE.Vector3(0, 28, 42)))
      } else if (mode === 'asteroid' && selectedObj) {
        camTarget.copy(selectedObj.mesh.position)
        camPos.copy(selectedObj.mesh.position.clone().add(new THREE.Vector3(0, 16, 24)))
      } else {
        camTarget.set(0, 0, 0)
        camPos.set(0, 140, 230)
      }

      controls.target.lerp(camTarget, 0.045)
      camera.position.lerp(camPos, 0.03)
      controls.update()

      renderer.render(scene, camera)
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      starsGeo.dispose()
      starsMat.dispose()
      sun.geometry.dispose()
      sun.material.dispose()
      sunGlow.geometry.dispose()
      sunGlow.material.dispose()
      earthLabel.material.map.dispose()
      earthLabel.material.dispose()

      planetMeshes.forEach((p) => {
        p.mesh.geometry.dispose()
        p.mesh.material.dispose()
      })

      orbitGroup.children.forEach((c) => {
        c.geometry.dispose()
        c.material.dispose()
      })

      asteroidObjects.forEach((a) => {
        a.mesh.geometry.dispose()
        a.mesh.material.dispose()
        a.line.geometry.dispose()
        a.line.material.dispose()
        if (a.label) {
          a.label.material.map.dispose()
          a.label.material.dispose()
        }
      })

      renderer.dispose()
      mount.innerHTML = ''
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, orbitData])

  return (
    <div className="real-orbit-wrap">
      <div className="real-orbit-toolbar">
        <button className={viewMode === 'solar' ? 'active' : ''} onClick={() => setViewMode('solar')}>Solar View</button>
        <button className={viewMode === 'earth' ? 'active' : ''} onClick={() => setViewMode('earth')}>Earth-Centric</button>
        <button className={viewMode === 'asteroid' ? 'active' : ''} onClick={() => setViewMode('asteroid')}>Asteroid Focus</button>
        <button onClick={() => setIsPlaying((v) => !v)}>{isPlaying ? 'Pause' : 'Play'}</button>
      </div>

      <div className="real-orbit-sliders">
        <label>
          Time: {slider.toFixed(1)}
          <input type="range" min="0" max="100" step="0.1" value={slider} onChange={(e) => setSlider(Number(e.target.value))} />
        </label>
        <label>
          Speed: {speed.toFixed(1)}x
          <input type="range" min="1" max="60" step="1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
      </div>

      <div className="real-orbit-canvas" ref={mountRef} />
      <p className="real-orbit-note">
        Educational live visualization based on NASA NeoWs orbital elements (not mission-grade trajectory prediction).
      </p>
    </div>
  )
}

export default RealOrbitViewer
