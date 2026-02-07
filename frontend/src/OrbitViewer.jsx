import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function mapLinear(value, inMin, inMax, outMin, outMax) {
  if (inMax <= inMin) return outMin
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1)
  return outMin + (outMax - outMin) * t
}

function mapLog(value, inMin, inMax, outMin, outMax) {
  const safe = clamp(value, inMin, inMax)
  const logMin = Math.log10(inMin)
  const logMax = Math.log10(inMax)
  const logValue = Math.log10(safe)
  return mapLinear(logValue, logMin, logMax, outMin, outMax)
}

function hashSeed(text) {
  let h = 0
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h / 4294967295
}

function buildOrbitModel(asteroid) {
  const missDistanceKm = clamp(toNumber(asteroid?.miss_distance_km, 1_500_000), 10_000, 200_000_000)
  const velocityKps = clamp(toNumber(asteroid?.relative_velocity_kps, 18), 3, 80)

  // Log scaling keeps far objects visible while preserving relative distance ordering.
  const semiMajor = mapLog(missDistanceKm, 10_000, 200_000_000, 8.5, 36)
  const eccentricity = clamp(mapLinear(velocityKps, 3, 80, 0.12, 0.72), 0.1, 0.78)
  const semiMinor = Math.max(semiMajor * Math.sqrt(1 - eccentricity * eccentricity), semiMajor * 0.32)
  const focusOffset = semiMajor * eccentricity

  const seed = hashSeed(String(asteroid?.id ?? asteroid?.name ?? 'neo'))
  const inclinationBase = mapLinear(velocityKps, 3, 80, 0.04, 0.4)
  const inclination = clamp(inclinationBase + (seed - 0.5) * 0.26, -0.55, 0.55)

  const orbitalPeriodHours = clamp((2 * Math.PI * missDistanceKm) / (velocityKps * 3600), 12, 24 * 365 * 3)
  const secondsPerCycle = clamp(orbitalPeriodHours * 0.03, 8, 70)
  const speedCyclesPerSecond = 1 / secondsPerCycle

  return {
    semiMajor,
    semiMinor,
    focusOffset,
    inclination,
    orbitalPeriodHours,
    speedCyclesPerSecond,
  }
}

function orbitPosition(model, angle) {
  const p = new THREE.Vector3(
    model.focusOffset + model.semiMajor * Math.cos(angle),
    0,
    model.semiMinor * Math.sin(angle)
  )
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), model.inclination)
  return p
}

function OrbitViewer({ asteroid, timelineHours, isPlaying }) {
  const hostRef = useRef(null)
  const asteroidRef = useRef(null)
  const earthRef = useRef(null)
  const systemRef = useRef(null)
  const orbitLineRef = useRef(null)
  const markerRef = useRef(null)
  const frameRef = useRef(0)
  const progressRef = useRef(0)
  const speedRef = useRef(0.015)
  const orbitModelRef = useRef(buildOrbitModel(null))
  const isPlayingRef = useRef(isPlaying)
  const timelineRef = useRef(timelineHours)

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    timelineRef.current = timelineHours
  }, [timelineHours])

  useEffect(() => {
    const mount = hostRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
    camera.position.set(0, 18, 30)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8))
    renderer.setSize(mount.clientWidth, Math.max(1, mount.clientHeight || 360))
    mount.innerHTML = ''
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 14
    controls.maxDistance = 70
    controls.maxPolarAngle = Math.PI * 0.85

    const ambient = new THREE.AmbientLight(0xb8d9ff, 1.2)
    scene.add(ambient)
    const fill = new THREE.PointLight(0x58d3ff, 1.5, 200)
    fill.position.set(10, 20, 15)
    scene.add(fill)

    const system = new THREE.Group()
    scene.add(system)
    systemRef.current = system

    const earthGeo = new THREE.SphereGeometry(2.1, 16, 16)
    const earthMat = new THREE.MeshStandardMaterial({
      color: 0x2f86ff,
      roughness: 0.55,
      metalness: 0.05,
    })
    const earth = new THREE.Mesh(earthGeo, earthMat)
    system.add(earth)
    earthRef.current = earth

    const asteroidGeo = new THREE.SphereGeometry(0.4, 10, 10)
    const asteroidMat = new THREE.MeshStandardMaterial({
      color: 0x6efdb1,
      roughness: 0.65,
      metalness: 0.1,
    })
    const asteroidMesh = new THREE.Mesh(asteroidGeo, asteroidMat)
    system.add(asteroidMesh)
    asteroidRef.current = asteroidMesh

    const initialModel = orbitModelRef.current
    const points = []
    for (let i = 0; i <= 240; i += 1) {
      const angle = (i / 240) * Math.PI * 2
      points.push(orbitPosition(initialModel, angle))
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(points)
    const orbitMat = new THREE.LineBasicMaterial({ color: 0xffb84d })
    const orbitRing = new THREE.LineLoop(orbitGeo, orbitMat)
    system.add(orbitRing)
    orbitLineRef.current = orbitRing

    const markerGeo = new THREE.SphereGeometry(0.5, 8, 8)
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff8f3c })
    const marker = new THREE.Mesh(markerGeo, markerMat)
    marker.position.copy(orbitPosition(initialModel, Math.PI))
    system.add(marker)
    markerRef.current = marker

    const starFieldGeo = new THREE.BufferGeometry()
    const starCount = 260
    const starVertices = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      starVertices[i * 3] = (Math.random() - 0.5) * 120
      starVertices[i * 3 + 1] = (Math.random() - 0.5) * 70
      starVertices[i * 3 + 2] = (Math.random() - 0.5) * 120
    }
    starFieldGeo.setAttribute('position', new THREE.BufferAttribute(starVertices, 3))
    const stars = new THREE.Points(
      starFieldGeo,
      new THREE.PointsMaterial({ color: 0xb8deff, size: 0.3, transparent: true, opacity: 0.75 })
    )
    scene.add(stars)

    const onResize = () => {
      if (!mount) return
      const width = mount.clientWidth
      const height = Math.max(1, mount.clientHeight || 360)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', onResize)
    onResize()

    let last = 0
    const tick = (t) => {
      frameRef.current = requestAnimationFrame(tick)
      if (t - last < 16) return
      const dt = last ? (t - last) / 1000 : 0
      last = t

      if (isPlayingRef.current) {
        progressRef.current += speedRef.current * dt
      }

      const model = orbitModelRef.current
      const timelineOffset = clamp(timelineRef.current, -12, 12) / model.orbitalPeriodHours
      const phase = progressRef.current + timelineOffset
      const angle = phase * Math.PI * 2
      asteroidMesh.position.copy(orbitPosition(model, angle))

      earth.rotation.y += 0.003
      system.rotation.y += 0.0012
      marker.scale.setScalar(1 + Math.sin(t * 0.005) * 0.14)
      controls.update()

      renderer.render(scene, camera)
    }
    frameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', onResize)
      starFieldGeo.dispose()
      orbitGeo.dispose()
      orbitMat.dispose()
      markerGeo.dispose()
      markerMat.dispose()
      asteroidGeo.dispose()
      asteroidMat.dispose()
      earthGeo.dispose()
      earthMat.dispose()
      controls.dispose()
      renderer.dispose()
      mount.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    const asteroidMesh = asteroidRef.current
    const orbitLine = orbitLineRef.current
    const marker = markerRef.current
    if (!asteroidMesh || !orbitLine || !marker) return

    const model = buildOrbitModel(asteroid)
    orbitModelRef.current = model
    speedRef.current = model.speedCyclesPerSecond

    const orbitPoints = []
    for (let i = 0; i <= 320; i += 1) {
      const angle = (i / 320) * Math.PI * 2
      orbitPoints.push(orbitPosition(model, angle))
    }
    const updatedGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints)
    orbitLine.geometry.dispose()
    orbitLine.geometry = updatedGeometry
    marker.position.copy(orbitPosition(model, Math.PI))

    const diameterM = clamp(toNumber(asteroid?.estimated_diameter_m, 250), 1, 5000)
    const size = clamp(mapLog(diameterM, 1, 5000, 0.2, 1.05), 0.2, 1.05)
    asteroidMesh.scale.setScalar(size)

    const risk = asteroid?.risk_category
    const riskColor = risk === 'High' ? 0xff6e6e : risk === 'Medium' ? 0xffca66 : 0x6efdb1
    asteroidMesh.material.color.setHex(riskColor)
    orbitLine.material.color.setHex(risk === 'High' ? 0xff9566 : 0xffb84d)
    marker.material.color.setHex(risk === 'High' ? 0xff6e6e : 0xff8f3c)
  }, [asteroid])

  return <div className="orbit-canvas" ref={hostRef} />
}

export default OrbitViewer
