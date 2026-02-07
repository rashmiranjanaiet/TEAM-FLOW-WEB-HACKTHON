import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function OrbitViewer({ asteroid, timelineHours, isPlaying }) {
  const hostRef = useRef(null)
  const asteroidRef = useRef(null)
  const earthRef = useRef(null)
  const systemRef = useRef(null)
  const markerRef = useRef(null)
  const frameRef = useRef(0)
  const progressRef = useRef(0)
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
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.innerHTML = ''
    mount.appendChild(renderer.domElement)

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

    const curve = new THREE.EllipseCurve(0, 0, 13, 8, 0, Math.PI * 2, false, 0)
    const points = curve.getPoints(180).map((p) => new THREE.Vector3(p.x, 0, p.y))
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(points)
    const orbitMat = new THREE.LineBasicMaterial({ color: 0xffb84d })
    const orbitRing = new THREE.LineLoop(orbitGeo, orbitMat)
    system.add(orbitRing)

    const markerGeo = new THREE.SphereGeometry(0.5, 8, 8)
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff8f3c })
    const marker = new THREE.Mesh(markerGeo, markerMat)
    marker.position.set(13, 0, 0)
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
      const height = mount.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', onResize)
    onResize()

    let last = 0
    const tick = (t) => {
      frameRef.current = requestAnimationFrame(tick)
      if (t - last < 33) return
      last = t

      if (isPlayingRef.current) {
        progressRef.current += 0.0016
      }

      const timelineOffset = clamp(timelineRef.current, -12, 12) / 24
      const phase = progressRef.current + timelineOffset
      const angle = phase * Math.PI * 2
      const x = 13 * Math.cos(angle)
      const z = 8 * Math.sin(angle)
      asteroidMesh.position.set(x, 0, z)

      earth.rotation.y += 0.003
      system.rotation.y += 0.0012
      marker.scale.setScalar(1 + Math.sin(t * 0.005) * 0.14)

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
      renderer.dispose()
      mount.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    const asteroidMesh = asteroidRef.current
    if (!asteroidMesh || !asteroid) return

    const size = clamp((asteroid.estimated_diameter_m || 0) / 500, 0.25, 0.9)
    asteroidMesh.scale.setScalar(size)
  }, [asteroid])

  return <div className="orbit-canvas" ref={hostRef} />
}

export default OrbitViewer
