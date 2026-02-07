import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function useBasicRenderer(hostRef, initScene) {
  useEffect(() => {
    const mount = hostRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.innerHTML = ''
    mount.appendChild(renderer.domElement)

    const api = initScene({ scene, camera, renderer, mount }) || {}
    const renderFrame = api.renderFrame || (() => {})
    const cleanup = api.cleanup || (() => {})

    const onResize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', onResize)
    onResize()

    let raf = 0
    let last = 0
    const tick = (time) => {
      raf = requestAnimationFrame(tick)
      if (time - last < 33) return
      last = time
      renderFrame(time)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      cleanup()
      renderer.dispose()
      mount.innerHTML = ''
    }
  }, [hostRef, initScene])
}

function buildStars(scene, count, spread) {
  const geo = new THREE.BufferGeometry()
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    arr[i * 3] = (Math.random() - 0.5) * spread
    arr[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.55
    arr[i * 3 + 2] = (Math.random() - 0.5) * spread
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const mat = new THREE.PointsMaterial({ color: 0xb8d7ff, size: 0.45, transparent: true, opacity: 0.75 })
  const points = new THREE.Points(geo, mat)
  scene.add(points)
  return { geo, mat, points }
}

export function HomeSpaceScene() {
  const hostRef = useRef(null)

  useBasicRenderer(hostRef, ({ scene, camera }) => {
    camera.position.set(0, 10, 26)
    camera.lookAt(0, 0, 0)

    const ambient = new THREE.AmbientLight(0x8fbaff, 1.15)
    const key = new THREE.PointLight(0x7bc5ff, 1.3, 300)
    key.position.set(16, 20, 16)
    scene.add(ambient, key)

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 28, 28),
      new THREE.MeshStandardMaterial({ color: 0x2e7be4, roughness: 0.56, metalness: 0.05 })
    )
    scene.add(earth)

    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(4.35, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xd9ebff, transparent: true, opacity: 0.1, roughness: 0.9 })
    )
    scene.add(cloud)

    const asteroids = []
    for (let i = 0; i < 8; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2 + Math.random() * 0.18, 0),
        new THREE.MeshStandardMaterial({ color: 0xb1bfcc, roughness: 1.0, metalness: 0.0 })
      )
      scene.add(mesh)
      asteroids.push({
        mesh,
        radius: 12 + Math.random() * 13,
        speed: 0.00022 + Math.random() * 0.0002,
        offset: Math.random() * Math.PI * 2,
        lift: (Math.random() - 0.5) * 6,
      })
    }

    const stars = buildStars(scene, 240, 180)

    return {
      renderFrame: (time) => {
        earth.rotation.y += 0.0016
        cloud.rotation.y += 0.0022
        const t = time
        for (const a of asteroids) {
          const ang = a.offset + t * a.speed
          a.mesh.position.set(
            Math.cos(ang) * a.radius,
            a.lift + Math.sin(ang * 1.6) * 0.8,
            Math.sin(ang) * a.radius
          )
        }
        camera.position.x = Math.sin(t * 0.00007) * 1.5
        camera.position.y = 10 + Math.sin(t * 0.00011) * 0.8
        camera.lookAt(0, 0, 0)
      },
      cleanup: () => {
        earth.geometry.dispose()
        earth.material.dispose()
        cloud.geometry.dispose()
        cloud.material.dispose()
        asteroids.forEach((a) => {
          a.mesh.geometry.dispose()
          a.mesh.material.dispose()
        })
        stars.geo.dispose()
        stars.mat.dispose()
      },
    }
  })

  return <div className="home-3d-canvas" ref={hostRef} />
}

export function TransitionSpaceScene() {
  const hostRef = useRef(null)

  useBasicRenderer(hostRef, ({ scene, camera }) => {
    camera.position.set(0, 5, 90)
    camera.lookAt(0, 0, 0)

    const ambient = new THREE.AmbientLight(0x96beff, 1.1)
    const key = new THREE.PointLight(0x6bbfff, 1.3, 350)
    key.position.set(20, 15, 25)
    scene.add(ambient, key)

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(6.2, 36, 36),
      new THREE.MeshStandardMaterial({ color: 0x2f83eb, roughness: 0.52, metalness: 0.04 })
    )
    scene.add(earth)

    const fly = []
    for (let i = 0; i < 26; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.24 + Math.random() * 0.2, 0),
        new THREE.MeshStandardMaterial({ color: 0x95a6b5, roughness: 1.0 })
      )
      mesh.position.set((Math.random() - 0.5) * 34, (Math.random() - 0.5) * 22, -40 - Math.random() * 120)
      scene.add(mesh)
      fly.push(mesh)
    }

    const stars = buildStars(scene, 360, 420)
    const start = performance.now()

    return {
      renderFrame: (time) => {
        const elapsed = time - start
        const p = clamp(elapsed / 1500, 0, 1)
        const eased = 1 - Math.pow(1 - p, 3)
        camera.position.z = 90 - eased * 62
        camera.position.y = 5 - eased * 2.5
        camera.lookAt(0, 0, 0)
        earth.rotation.y += 0.0022

        fly.forEach((m, idx) => {
          m.position.z += 0.8 + (idx % 5) * 0.15
          if (m.position.z > 20) m.position.z = -160
          m.rotation.x += 0.01
          m.rotation.y += 0.008
        })
      },
      cleanup: () => {
        earth.geometry.dispose()
        earth.material.dispose()
        fly.forEach((m) => {
          m.geometry.dispose()
          m.material.dispose()
        })
        stars.geo.dispose()
        stars.mat.dispose()
      },
    }
  })

  return <div className="transition-3d-canvas" ref={hostRef} />
}

function mapToModel(items) {
  return items.slice(0, 30).map((item, idx) => {
    const miss = clamp(Number(item.miss_distance_km) || 2_000_000, 50_000, 100_000_000)
    const speed = clamp(Number(item.relative_velocity_kps) || 10, 1, 80)
    const risk = String(item.risk_category || 'Low')
    const radius = 12 + Math.log10(miss + 1) * 5.5
    return {
      id: item.id,
      radius,
      size: clamp((Number(item.estimated_diameter_m) || 40) / 160, 0.18, 1.0),
      speed: 0.00035 + speed * 0.00005,
      offset: (idx / Math.max(1, items.length)) * Math.PI * 2,
      tilt: ((idx % 7) - 3) * 0.07,
      color: risk === 'High' ? 0xff7272 : risk === 'Medium' ? 0xffc56c : 0x68dfb4,
    }
  })
}

export function LiveMap3D({ items }) {
  const hostRef = useRef(null)
  const model = useMemo(() => mapToModel(items || []), [items])

  useBasicRenderer(hostRef, ({ scene, camera }) => {
    camera.position.set(0, 30, 46)
    camera.lookAt(0, 0, 0)

    const ambient = new THREE.AmbientLight(0x9bc7ff, 1.08)
    const key = new THREE.PointLight(0x6dc5ff, 1.05, 400)
    key.position.set(25, 35, 20)
    scene.add(ambient, key)

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x2f86ff, roughness: 0.55, metalness: 0.05 })
    )
    scene.add(earth)

    const asteroidMeshes = []
    const orbitLines = []
    model.forEach((m) => {
      const linePoints = []
      for (let i = 0; i <= 160; i += 1) {
        const a = (i / 160) * Math.PI * 2
        const p = new THREE.Vector3(
          Math.cos(a) * m.radius,
          Math.sin(a * 1.4) * m.tilt,
          Math.sin(a) * (m.radius * 0.68)
        )
        linePoints.push(p)
      }
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(linePoints),
        new THREE.LineBasicMaterial({ color: 0x9bc9ff, transparent: true, opacity: 0.3 })
      )
      scene.add(line)
      orbitLines.push(line)

      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(m.size, 0),
        new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.98, metalness: 0.0 })
      )
      scene.add(mesh)
      asteroidMeshes.push({ mesh, m })
    })

    const stars = buildStars(scene, 420, 320)

    return {
      renderFrame: (time) => {
        const t = time
        earth.rotation.y += 0.0018
        asteroidMeshes.forEach(({ mesh, m }) => {
          const a = m.offset + t * m.speed
          mesh.position.set(
            Math.cos(a) * m.radius,
            Math.sin(a * 1.3) * m.tilt,
            Math.sin(a) * (m.radius * 0.68)
          )
          mesh.rotation.x += 0.01
          mesh.rotation.y += 0.008
        })
        camera.position.x = Math.sin(t * 0.00008) * 5
        camera.lookAt(0, 0, 0)
      },
      cleanup: () => {
        earth.geometry.dispose()
        earth.material.dispose()
        asteroidMeshes.forEach(({ mesh }) => {
          mesh.geometry.dispose()
          mesh.material.dispose()
        })
        orbitLines.forEach((line) => {
          line.geometry.dispose()
          line.material.dispose()
        })
        stars.geo.dispose()
        stars.mat.dispose()
      },
    }
  })

  return <div className="live-map-3d-canvas" ref={hostRef} />
}
