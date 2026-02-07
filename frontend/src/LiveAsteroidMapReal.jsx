import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const AU_SCALE = 42
const FRAME_MS = 33
const SPEED_PRESETS = [1, 10, 100, 1000]

const PLANETS = [
  { name: 'Mercury', a: 0.39, periodDays: 88, color: 0xa5a6a8, size: 0.28 },
  { name: 'Venus', a: 0.72, periodDays: 224.7, color: 0xc6a97f, size: 0.46 },
  { name: 'Earth', a: 1.0, periodDays: 365.25, color: 0x3f78d2, size: 0.52 },
  { name: 'Mars', a: 1.52, periodDays: 687, color: 0xb17364, size: 0.4 },
  { name: 'Jupiter', a: 5.2, periodDays: 4333, color: 0xb98563, size: 1.05 },
  { name: 'Saturn', a: 9.58, periodDays: 10759, color: 0xc5ab82, size: 0.95 },
]

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}

function degToRad(v) {
  return (Number(v) || 0) * (Math.PI / 180)
}

function solveE(M, e) {
  let E = M
  for (let i = 0; i < 7; i += 1) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  }
  return E
}

function keplerPosition(elements, days) {
  const a = Number(elements?.semi_major_axis_au)
  const e = Number(elements?.eccentricity)
  if (!Number.isFinite(a) || !Number.isFinite(e) || a <= 0) return new THREE.Vector3(0, 0, 0)

  const i = degToRad(elements?.inclination_deg)
  const Omega = degToRad(elements?.ascending_node_longitude_deg)
  const omega = degToRad(elements?.perihelion_argument_deg)
  const M0 = degToRad(elements?.mean_anomaly_deg)
  const n = Number(elements?.mean_motion_deg_per_day)
  const meanMotion = Number.isFinite(n) && n > 0 ? degToRad(n) : degToRad(0.9856076686 / Math.pow(a, 1.5))

  const M = M0 + meanMotion * days
  const E = solveE(M, e)

  const xOrb = a * (Math.cos(E) - e)
  const yOrb = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E)

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

function distanceWarningLevel(missDistanceKm) {
  const km = Number(missDistanceKm || 0)
  if (km <= 7_500_000) return 'High'
  if (km <= 20_000_000) return 'Medium'
  return 'Low'
}

function asteroidColor(warningLevel) {
  if (warningLevel === 'High') return 0xd86a43
  if (warningLevel === 'Medium') return 0xd3a34d
  return 0x7e8c95
}

function riskDot(warningLevel) {
  if (warningLevel === 'High') return 'dot-red'
  if (warningLevel === 'Medium') return 'dot-yellow'
  return 'dot-green'
}

function fmtDate(d) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function classifyOrbit(orbitalElements) {
  const a = Number(orbitalElements?.semi_major_axis_au)
  const e = Number(orbitalElements?.eccentricity)
  if (!Number.isFinite(a) || !Number.isFinite(e)) return 'Unclassified'
  const q = a * (1 - e)
  const Q = a * (1 + e)
  if (a > 1 && q < 1.017) return 'Apollo'
  if (a < 1 && Q > 0.983) return 'Aten'
  if (q > 1.017 && q < 1.3) return 'Amor'
  return 'Unclassified'
}

function fmtKm(v) {
  return Math.round(Number(v || 0)).toLocaleString()
}

function riskFromTorinoFilter(value, row) {
  if (value === 'all') return true
  if (value === 'threatening') return row.risk_category === 'High' || Number(row.risk_score || 0) >= 70
  if (value === 'attention') return row.risk_category === 'Medium' || (Number(row.risk_score || 0) >= 40 && Number(row.risk_score || 0) < 70)
  return row.risk_category === 'Low' || Number(row.risk_score || 0) < 40
}

function LiveAsteroidMapReal({ items, onStartDateChange, onEndDateChange, onApplyDateRange, onRefresh }) {
  const mountRef = useRef(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const asteroidMeshesRef = useRef([])
  const objectsRef = useRef([])
  const frameRef = useRef(0)

  const [riskLevelFilter, setRiskLevelFilter] = useState('all')
  const [subTab, setSubTab] = useState('solar')
  const [cameraPreset, setCameraPreset] = useState('earth_close')
  const [isPlaying, setIsPlaying] = useState(true)
  const [speedIndex, setSpeedIndex] = useState(1)
  const [timeSlider, setTimeSlider] = useState(0)
  const [hoverText, setHoverText] = useState('')
  const [selectedAsteroid, setSelectedAsteroid] = useState(null)
  const [orbitRows, setOrbitRows] = useState([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [rangePreset, setRangePresetState] = useState('week')
  const [rangeLoading, setRangeLoading] = useState(false)

  const playRef = useRef(isPlaying)
  const speedRef = useRef(speedIndex)
  const cameraPresetRef = useRef(cameraPreset)
  const sliderRef = useRef(timeSlider)
  const selectedIdRef = useRef(null)
  const hoverRef = useRef('')

  useEffect(() => { playRef.current = isPlaying }, [isPlaying])
  useEffect(() => { speedRef.current = speedIndex }, [speedIndex])
  useEffect(() => { cameraPresetRef.current = cameraPreset }, [cameraPreset])
  useEffect(() => { sliderRef.current = timeSlider }, [timeSlider])
  useEffect(() => { selectedIdRef.current = selectedAsteroid?.id || null }, [selectedAsteroid])

  const filteredItems = useMemo(() => {
    return (items || []).filter((x) => riskFromTorinoFilter(riskLevelFilter, x)).slice(0, 24)
  }, [items, riskLevelFilter])

  const stats = useMemo(() => {
    const total = filteredItems.length
    const high = filteredItems.filter((x) => x.risk_category === 'High').length
    const medium = filteredItems.filter((x) => x.risk_category === 'Medium').length
    const low = filteredItems.filter((x) => x.risk_category === 'Low').length
    return { total, high, medium, low }
  }, [filteredItems])

  const analysis = useMemo(() => {
    const byClass = { Apollo: 0, Aten: 0, Amor: 0 }
    orbitRows.forEach((x) => {
      const c = classifyOrbit(x.orbital_elements)
      if (byClass[c] != null) byClass[c] += 1
    })
    return byClass
  }, [orbitRows])

  const scatterData = useMemo(() => {
    return orbitRows.map((x) => ({
      distanceAu: Number(x.miss_distance_km || 0) / 149597870.7,
      velocity: Number(x.relative_velocity_kps || 0),
      risk: x.risk_category,
      name: x.name,
    }))
  }, [orbitRows])

  useEffect(() => {
    let cancelled = false
    async function loadOrbitData() {
      const reqs = filteredItems.map(async (x) => {
        try {
          const r = await fetch(`${API_BASE}/lookup/${x.id}`)
          if (!r.ok) return null
          const data = await r.json()
          const item = data?.item
          if (!item?.orbital_elements?.semi_major_axis_au) return null
          const warning_level = distanceWarningLevel(x.miss_distance_km)
          return { ...x, orbital_elements: item.orbital_elements, warning_level }
        } catch {
          return null
        }
      })
      const rows = (await Promise.all(reqs)).filter(Boolean)
      if (!cancelled) {
        setOrbitRows(rows)
        setUpdatedAt(new Date().toLocaleTimeString())
        setSelectedAsteroid((prev) => {
          if (prev) {
            const keep = rows.find((r) => r.id === prev.id)
            if (keep) return keep
          }
          return rows[0] || null
        })
      }
    }
    loadOrbitData()
    return () => { cancelled = true }
  }, [filteredItems])

  useEffect(() => {
    if (subTab !== 'solar') return undefined
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x010307)

    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 5000)
    camera.position.set(0, 120, 220)

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
    controls.maxDistance = 1900

    const ambient = new THREE.AmbientLight(0x455672, 0.2)
    scene.add(ambient)

    const sunLight = new THREE.PointLight(0xffe6ab, 2.0, 2800)
    scene.add(sunLight)

    const starsGeo = new THREE.BufferGeometry()
    const starCount = 2500
    const starPos = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      starPos[i * 3] = (Math.random() - 0.5) * 3400
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 2200
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 3400
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starsMat = new THREE.PointsMaterial({ color: 0xb7c7dd, size: 1.0, transparent: true, opacity: 0.72 })
    const stars = new THREE.Points(starsGeo, starsMat)
    scene.add(stars)

    const sun = new THREE.Mesh(new THREE.SphereGeometry(5.6, 28, 28), new THREE.MeshBasicMaterial({ color: 0xf4cd65 }))
    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(8.8, 22, 22),
      new THREE.MeshBasicMaterial({ color: 0xffb65b, transparent: true, opacity: 0.24 })
    )
    scene.add(sun, sunGlow)

    const orbitGroup = new THREE.Group()
    const planetGroup = new THREE.Group()
    const asteroidGroup = new THREE.Group()
    scene.add(orbitGroup, planetGroup, asteroidGroup)

    const planetMeshes = PLANETS.map((p) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(p.size, 18, 18),
        new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.68, metalness: 0.02 })
      )
      planetGroup.add(m)

      const points = []
      for (let i = 0; i <= 280; i += 1) {
        const t = (i / 280) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(t) * p.a * AU_SCALE, 0, Math.sin(t) * p.a * AU_SCALE))
      }
      const orbitLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x47596a, transparent: true, opacity: 0.34 })
      )
      orbitGroup.add(orbitLine)
      return { ...p, mesh: m, orbitLine }
    })

    asteroidMeshesRef.current = orbitRows.map((row) => {
      const dKm = Number(row.estimated_diameter_km || 0.01)
      const size = clamp(Math.log10(dKm * 1000 + 1) * 0.18, 0.14, 0.9)
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size, 0),
        new THREE.MeshStandardMaterial({ color: asteroidColor(row.warning_level), roughness: 0.96, metalness: 0.0 })
      )
      asteroidGroup.add(mesh)

      const orbitPts = []
      for (let i = 0; i <= 260; i += 1) orbitPts.push(keplerPosition(row.orbital_elements, (i / 260) * 365))
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(orbitPts),
        new THREE.LineBasicMaterial({ color: asteroidColor(row.warning_level), transparent: true, opacity: 0.5 })
      )
      orbitGroup.add(line)
      return { row, mesh, line }
    })
    objectsRef.current = asteroidMeshesRef.current.map((x) => x.mesh)

    const onResize = () => {
      const w = mount.clientWidth
      const h = Math.max(1, mount.clientHeight)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)
    onResize()

    const onPointerMove = (ev) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointerRef.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      pointerRef.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    }

    const onClick = () => {
      raycasterRef.current.setFromCamera(pointerRef.current, camera)
      const hits = raycasterRef.current.intersectObjects(objectsRef.current, false)
      if (hits.length > 0) {
        const hit = asteroidMeshesRef.current.find((x) => x.mesh === hits[0].object)
        if (hit) setSelectedAsteroid(hit.row)
      }
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('click', onClick)

    const sim = { days: 0, targetDays: 0 }
    let last = 0
    let lastSliderUpdate = 0

    const animate = (ms) => {
      frameRef.current = requestAnimationFrame(animate)
      if (ms - last < FRAME_MS) return
      const dt = last ? (ms - last) / 1000 : 0
      last = ms

      const speed = SPEED_PRESETS[speedRef.current]
      if (playRef.current) sim.targetDays = (sim.targetDays + dt * speed * 0.12) % 365
      else sim.targetDays = (sliderRef.current / 100) * 365
      sim.days += (sim.targetDays - sim.days) * 0.09

      if (playRef.current && ms - lastSliderUpdate > 180) {
        lastSliderUpdate = ms
        setTimeSlider(Number(((sim.days / 365) * 100).toFixed(1)))
      }

      let earthPos = new THREE.Vector3()
      planetMeshes.forEach((p) => {
        const t = (sim.days / p.periodDays) * Math.PI * 2
        p.mesh.position.set(Math.cos(t) * p.a * AU_SCALE, 0, Math.sin(t) * p.a * AU_SCALE)
        p.mesh.rotation.y += dt * 0.36
        if (p.name === 'Earth') earthPos = p.mesh.position.clone()
      })

      asteroidMeshesRef.current.forEach((obj) => {
        const pos = keplerPosition(obj.row.orbital_elements, sim.days)
        obj.mesh.position.copy(pos)
        obj.mesh.rotation.y += dt * 0.3
      })

      raycasterRef.current.setFromCamera(pointerRef.current, camera)
      const hits = raycasterRef.current.intersectObjects(objectsRef.current, false)
      let nextHover = ''
      if (hits.length > 0) {
        const hit = asteroidMeshesRef.current.find((x) => x.mesh === hits[0].object)
        if (hit) {
          nextHover = `${hit.row.name} | Distance Alert: ${hit.row.warning_level} | ${Number(hit.row.relative_velocity_kps || 0).toFixed(1)} km/s | ${(Number(hit.row.miss_distance_km || 0) / 149597870.7).toFixed(2)} AU`
        }
      }
      if (nextHover !== hoverRef.current) {
        hoverRef.current = nextHover
        setHoverText(nextHover)
      }

      const selectedObj = asteroidMeshesRef.current.find((x) => x.row.id === selectedIdRef.current)
      const preset = cameraPresetRef.current
      const camTarget = new THREE.Vector3(0, 0, 0)
      const camPos = new THREE.Vector3(0, 120, 220)

      if (preset === 'earth_close') {
        camTarget.copy(earthPos)
        camPos.copy(earthPos.clone().add(new THREE.Vector3(0, 20, 32)))
      } else if (preset === 'inner_system') {
        camPos.set(0, 98, 145)
      } else if (preset === 'neo' && selectedObj) {
        camTarget.copy(selectedObj.mesh.position)
        camPos.copy(selectedObj.mesh.position.clone().add(new THREE.Vector3(0, 24, 42)))
      } else if (preset === 'earth_moon') {
        camTarget.copy(earthPos)
        camPos.copy(earthPos.clone().add(new THREE.Vector3(0, 26, 48)))
      }

      controls.target.lerp(camTarget, 0.06)
      camera.position.lerp(camPos, 0.04)
      controls.update()
      renderer.render(scene, camera)
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameRef.current)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('click', onClick)
      window.removeEventListener('resize', onResize)
      controls.dispose()

      planetMeshes.forEach((p) => {
        p.mesh.geometry.dispose()
        p.mesh.material.dispose()
        p.orbitLine.geometry.dispose()
        p.orbitLine.material.dispose()
      })

      asteroidMeshesRef.current.forEach((obj) => {
        obj.mesh.geometry.dispose()
        obj.mesh.material.dispose()
        obj.line.geometry.dispose()
        obj.line.material.dispose()
      })

      starsGeo.dispose()
      starsMat.dispose()
      sun.geometry.dispose()
      sun.material.dispose()
      sunGlow.geometry.dispose()
      sunGlow.material.dispose()
      renderer.dispose()
      mount.innerHTML = ''
    }
  }, [orbitRows, subTab])

  const nearby = orbitRows.slice(0, 16)

  const setRangePreset = async (mode) => {
    setRangePresetState(mode)
    setRangeLoading(true)
    const end = new Date()
    const start = new Date()
    if (mode === 'day') start.setDate(end.getDate() - 1)
    if (mode === 'week') start.setDate(end.getDate() - 7)
    if (mode === 'month') start.setDate(end.getDate() - 30)
    if (mode === 'year') start.setDate(end.getDate() - 365)
    const nextStart = fmtDate(start)
    const nextEnd = fmtDate(end)
    try {
      if (onApplyDateRange) await onApplyDateRange(nextStart, nextEnd)
      else {
        onStartDateChange(nextStart)
        onEndDateChange(nextEnd)
        await onRefresh()
      }
    } finally {
      setRangeLoading(false)
    }
  }

  const manualRefresh = async () => {
    setRangeLoading(true)
    try {
      await onRefresh()
    } finally {
      setRangeLoading(false)
    }
  }

  return (
    <section className="panel realmap-shell">
      <div className="realmap-subnav">
        <h2>AstroWatch</h2>
        <div className="realmap-sub-actions">
          <button disabled={rangeLoading} className={rangePreset === 'day' ? 'active' : ''} onClick={() => setRangePreset('day')}>Day</button>
          <button disabled={rangeLoading} className={rangePreset === 'week' ? 'active' : ''} onClick={() => setRangePreset('week')}>Week</button>
          <button disabled={rangeLoading} className={rangePreset === 'month' ? 'active' : ''} onClick={() => setRangePreset('month')}>Month</button>
          <button disabled={rangeLoading} className={rangePreset === 'year' ? 'active' : ''} onClick={() => setRangePreset('year')}>Year</button>
          <select value={riskLevelFilter} onChange={(e) => setRiskLevelFilter(e.target.value)}>
            <option value="all">All Torino Levels</option>
            <option value="threatening">Threatening (5-10)</option>
            <option value="attention">Attention (2-4)</option>
            <option value="normal">Normal (0-1)</option>
          </select>
          <button className={subTab === 'solar' ? 'active purple' : ''} onClick={() => setSubTab('solar')}>Solar System</button>
          <button className={subTab === 'dashboard' ? 'active' : ''} onClick={() => setSubTab('dashboard')}>Dashboard</button>
          <button className={subTab === 'analysis' ? 'active violet' : ''} onClick={() => setSubTab('analysis')}>Analysis Hub</button>
          <button className={subTab === 'trajectories' ? 'active green' : ''} onClick={() => setSubTab('trajectories')}>Trajectories</button>
          <a className="orange" href="https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY" target="_blank" rel="noreferrer">Picture of the Day</a>
        </div>
      </div>
      <p className="muted">Source: NASA NeoWs (via backend API key). {rangeLoading ? 'Loading live data...' : 'Live controls ready.'}</p>

      {subTab === 'solar' && (
        <div className="realmap-solar-stage">
          <div className="realmap-overlay-left">
            <h4>Camera Views</h4>
            <button className={cameraPreset === 'earth_close' ? 'active' : ''} onClick={() => setCameraPreset('earth_close')}>Earth Close-up</button>
            <button className={cameraPreset === 'earth_moon' ? 'active' : ''} onClick={() => setCameraPreset('earth_moon')}>Earth-Moon System</button>
            <button className={cameraPreset === 'neo' ? 'active' : ''} onClick={() => setCameraPreset('neo')}>Near-Earth Objects</button>
            <button className={cameraPreset === 'inner_system' ? 'active' : ''} onClick={() => setCameraPreset('inner_system')}>Inner Solar System</button>
            <div className="realmap-control-stack">
              <button className="btn" onClick={() => setIsPlaying((v) => !v)}>{isPlaying ? 'Pause' : 'Play'}</button>
              <label>
                Speed {SPEED_PRESETS[speedIndex]}x
                <input type="range" min="0" max="3" step="1" value={speedIndex} onChange={(e) => setSpeedIndex(Number(e.target.value))} />
              </label>
              <label>
                Timeline
                <input type="range" min="0" max="100" step="0.1" value={timeSlider} onChange={(e) => setTimeSlider(Number(e.target.value))} />
              </label>
              <button className="btn" onClick={manualRefresh} disabled={rangeLoading}>
                {rangeLoading ? 'Refreshing...' : 'Refresh NASA Data'}
              </button>
            </div>
          </div>

          <div className="realmap-canvas-wrap">
            <div className="realmap-canvas" ref={mountRef} />
            {hoverText && <div className="realmap-tooltip">{hoverText}</div>}
          </div>

          <aside className="realmap-overlay-right">
            <h4>Nearby Asteroids</h4>
            <p>Click to select. Hover to highlight.</p>
            <div className="nearby-list">
              {nearby.map((x) => (
                <button key={x.id} className={`nearby-item ${selectedAsteroid?.id === x.id ? 'selected' : ''}`} onClick={() => setSelectedAsteroid(x)}>
                  <div><strong>{x.name}</strong></div>
                  <div className="muted">
                    <span className={`risk-dot ${riskDot(x.warning_level)}`} />
                    Distance Alert: {x.warning_level}  {Number(x.estimated_diameter_m || 0).toFixed(1)} m
                  </div>
                  <div className="muted">{Number(x.relative_velocity_kps || 0).toFixed(1)} km/s  {(Number(x.miss_distance_km || 0) / 149597870.7).toFixed(2)} AU</div>
                </button>
              ))}
            </div>
          </aside>

          <div className="realmap-scale">Torino Impact Hazard Scale</div>
        </div>
      )}

      {subTab === 'analysis' && (
        <section className="analysis-grid">
          <article className="panel">
            <h3>Orbital Classification</h3>
            <div className="class-cards">
              <div className="class-card red"><strong>{analysis.Apollo}</strong><span>Apollo Type</span></div>
              <div className="class-card yellow"><strong>{analysis.Aten}</strong><span>Aten Type</span></div>
              <div className="class-card green"><strong>{analysis.Amor}</strong><span>Amor Type</span></div>
            </div>
            <p className="muted">Average miss distance: {(scatterData.reduce((acc, v) => acc + v.distanceAu, 0) / Math.max(scatterData.length, 1)).toFixed(3)} AU</p>
          </article>
          <article className="panel">
            <h3>Velocity vs Distance Analysis</h3>
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,180,230,0.15)" />
                <XAxis type="number" dataKey="distanceAu" name="Miss Distance (AU)" stroke="#b9d6fb" />
                <YAxis type="number" dataKey="velocity" name="Velocity (km/s)" stroke="#b9d6fb" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={scatterData} fill="#ffc86a" />
              </ScatterChart>
            </ResponsiveContainer>
          </article>
        </section>
      )}

      {subTab === 'dashboard' && (
        <section className="analysis-grid">
          <article className="panel">
            <h3>Map Summary</h3>
            <div className="class-cards">
              <div className="class-card neutral"><strong>{stats.total}</strong><span>Total</span></div>
              <div className="class-card red"><strong>{stats.high}</strong><span>High</span></div>
              <div className="class-card yellow"><strong>{stats.medium}</strong><span>Medium</span></div>
              <div className="class-card green"><strong>{stats.low}</strong><span>Low</span></div>
            </div>
            <p className="muted">Visualization based on NASA NeoWs orbital elements. Motion is time-scaled for educational purposes.</p>
          </article>
          <article className="panel">
            <h3>Selected Object</h3>
            {!selectedAsteroid && <p className="muted">Select an asteroid from Solar System view.</p>}
            {selectedAsteroid && (
              <div className="selected-meta">
                <h4>{selectedAsteroid.name}</h4>
                <p>Risk: {selectedAsteroid.risk_category} ({selectedAsteroid.risk_score}/100)</p>
                <p>Distance Alert: {selectedAsteroid.warning_level}</p>
                <p>Diameter: {Number(selectedAsteroid.estimated_diameter_km || 0).toFixed(6)} km</p>
                <p>Velocity: {Number(selectedAsteroid.relative_velocity_kph || 0).toFixed(1)} km/h</p>
                <p>Miss Distance: {fmtKm(selectedAsteroid.miss_distance_km)} km</p>
              </div>
            )}
          </article>
        </section>
      )}

      {subTab === 'trajectories' && (
        <section className="panel">
          <h3>Trajectory Table</h3>
          <div className="trajectory-table-wrap">
            <table className="trajectory-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>a (AU)</th>
                  <th>e</th>
                  <th>i (deg)</th>
                  <th>Mean Motion (deg/day)</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {orbitRows.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td>{Number(x.orbital_elements?.semi_major_axis_au || 0).toFixed(3)}</td>
                    <td>{Number(x.orbital_elements?.eccentricity || 0).toFixed(3)}</td>
                    <td>{Number(x.orbital_elements?.inclination_deg || 0).toFixed(2)}</td>
                    <td>{Number(x.orbital_elements?.mean_motion_deg_per_day || 0).toFixed(3)}</td>
                    <td>{x.risk_category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="realmap-footer">
        <span>Total Asteroids: {items.length}</span>
        <span>Filtered: {filteredItems.length}</span>
        <span>Threatening: {stats.high}</span>
        <span>Last Updated: {updatedAt || '-'}</span>
      </footer>
    </section>
  )
}

export default LiveAsteroidMapReal
