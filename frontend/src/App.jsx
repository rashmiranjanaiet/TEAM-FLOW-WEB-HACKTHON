import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RealOrbitViewer from './RealOrbitViewer'
import { HomeSpaceScene, TransitionSpaceScene } from './SpaceScenes'
import SimpleCharts from './SimpleCharts'
import LiveAsteroidMapReal from './LiveAsteroidMapReal'
import './styles.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const REFRESH_INTERVAL_MS = 15000
const LAST_FEED_CACHE_KEY = 'cosmic_watch_last_feed'
const WS_CHAT_BASE = (() => {
  try {
    const url = new URL(API_BASE)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws/chat'
    return url.toString()
  } catch {
    return 'ws://localhost:8000/ws/chat'
  }
})()

function fmt(n) {
  if (Number.isNaN(Number(n))) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n))
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateString, days) {
  const d = new Date(dateString)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function riskClass(category) {
  if (category === 'High') return 'risk risk-high'
  if (category === 'Medium') return 'risk risk-medium'
  return 'risk risk-low'
}

function riskTone(score) {
  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

function colorForRisk(score) {
  if (score >= 70) return '#ff6868'
  if (score >= 40) return '#ffc86a'
  return '#59dda9'
}

function sizeToHuman(diameterM) {
  if (diameterM < 6) return 'about a small car'
  if (diameterM < 18) return 'about a bus'
  if (diameterM < 40) return 'about a house'
  if (diameterM < 120) return 'about a building'
  if (diameterM < 350) return 'about a stadium'
  return 'about a city block'
}

function distanceToHuman(missDistanceKm) {
  const moonDistance = 384400
  if (missDistanceKm <= moonDistance) return 'closer than the Moon'
  if (missDistanceKm <= moonDistance * 3) return 'within a few lunar distances'
  if (missDistanceKm <= 7_500_000) return 'inside near-Earth caution distance'
  return 'farther from Earth'
}

function chatTime(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState(addDays(today(), 2))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [selectedAsteroidId, setSelectedAsteroidId] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [watchlistIds, setWatchlistIds] = useState([])
  const [watchlistEntries, setWatchlistEntries] = useState([])
  const [alertThreshold, setAlertThreshold] = useState(65)
  const [transitionVisible, setTransitionVisible] = useState(false)
  const [pendingTab, setPendingTab] = useState('')
  const [showBgVideo, setShowBgVideo] = useState(false)
  const [bgVideoKey, setBgVideoKey] = useState(0)
  const [bgVideoSrc, setBgVideoSrc] = useState('')
  const [bgVideoLoop, setBgVideoLoop] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [authUser, setAuthUser] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  const [chatStatus, setChatStatus] = useState('Connecting...')
  const [chatName, setChatName] = useState('Pilot')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [activeUsers, setActiveUsers] = useState(0)
  const socketRef = useRef(null)
  const reconnectRef = useRef(0)
  const shouldReconnectRef = useRef(true)
  const chatEndRef = useRef(null)
  const transitionRef = useRef(0)

  function selectTab(nextTab) {
    if (nextTab === activeTab) return
    if (nextTab === 'dashboard') {
      setPendingTab(nextTab)
      setTransitionVisible(true)
      clearTimeout(transitionRef.current)
      transitionRef.current = setTimeout(() => {
        setActiveTab(nextTab)
        setTransitionVisible(false)
      }, 1800)
      return
    }
    setActiveTab(nextTab)
  }

  const loadDataForRange = useCallback(async (rangeStart, rangeEnd) => {
    setLoading(true)
    setError('')
    try {
      const feedRes = await fetch(`${API_BASE}/feed?start_date=${rangeStart}&end_date=${rangeEnd}`)

      if (!feedRes.ok) throw new Error(`Feed API failed: ${await feedRes.text()}`)

      const feedData = await feedRes.json()
      const nextItems = feedData.items || []
      const summaryData = {
        total: nextItems.length,
        high_risk: nextItems.filter((x) => x.risk_category === 'High').length,
        medium_risk: nextItems.filter((x) => x.risk_category === 'Medium').length,
        low_risk: nextItems.filter((x) => x.risk_category === 'Low').length,
      }
      setItems(nextItems)
      setSummary(summaryData)
      setLastUpdated(new Date().toLocaleTimeString())
      setSelectedAsteroidId((prev) => (prev ? prev : (nextItems[0]?.id || '')))
      localStorage.setItem(
        LAST_FEED_CACHE_KEY,
        JSON.stringify({
          startDate: rangeStart,
          endDate: rangeEnd,
          items: nextItems,
          summary: summaryData,
          cachedAt: new Date().toISOString(),
        })
      )
    } catch (e) {
      const message = e.message || 'Unknown error'
      const isRateLimited = message.includes('NASA_RATE_LIMIT') || message.includes('429')
      if (isRateLimited) {
        const cachedRaw = localStorage.getItem(LAST_FEED_CACHE_KEY)
        if (cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw)
            setItems(cached.items || [])
            setSummary(cached.summary || null)
            setLastUpdated(new Date().toLocaleTimeString())
            setSelectedAsteroidId((prev) => (prev ? prev : (cached.items?.[0]?.id || '')))
            setError('NASA rate limit reached. Showing last cached live dataset.')
            return
          } catch {
            setError(message)
          }
        } else {
          setError('NASA rate limit reached and no cached dataset is available yet.')
        }
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const loadData = useCallback(async () => {
    await loadDataForRange(startDate, endDate)
  }, [loadDataForRange, startDate, endDate])

  const applyDateRange = useCallback(async (rangeStart, rangeEnd) => {
    setStartDate(rangeStart)
    setEndDate(rangeEnd)
    await loadDataForRange(rangeStart, rangeEnd)
  }, [loadDataForRange])

  function appendChatMessage(msg) {
    setChatMessages((prev) => [...prev.slice(-149), msg])
  }

  function sendSocket(payload) {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  function connectChat() {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }
    setChatStatus('Connecting...')
    const socket = new WebSocket(WS_CHAT_BASE)
    socketRef.current = socket

    socket.onopen = () => {
      setChatStatus('Live')
      sendSocket({ type: 'set_name', name: chatName.trim() || 'Pilot' })
    }
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (typeof payload.active_users === 'number') {
          setActiveUsers(payload.active_users)
        }
        appendChatMessage(payload)
      } catch {
        appendChatMessage({ type: 'error', message: 'Received non-JSON chat payload.', timestamp: new Date().toISOString() })
      }
    }
    socket.onerror = () => setChatStatus('Connection issue')
    socket.onclose = () => {
      setChatStatus('Offline')
      if (!shouldReconnectRef.current) return
      clearTimeout(reconnectRef.current)
      reconnectRef.current = setTimeout(connectChat, 2000)
    }
  }

  function sendChatMessage() {
    const text = chatInput.trim()
    if (!text) return
    if (sendSocket({ type: 'chat', text })) {
      setChatInput('')
    }
  }

  async function loadWatchlist(token = authToken) {
    if (!token) {
      setWatchlistEntries([])
      setWatchlistIds([])
      return
    }
    try {
      const res = await fetch(`${API_BASE}/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const entries = data.items || []
      setWatchlistEntries(entries)
      setWatchlistIds(entries.map((x) => x.asteroid_id))
    } catch (e) {
      setError(`Watchlist load failed: ${e.message || 'Unknown error'}`)
    }
  }

  async function submitAuth() {
    setAuthLoading(true)
    setAuthError('')
    try {
      const url = authMode === 'register' ? `${API_BASE}/auth/register` : `${API_BASE}/auth/login`
      const body = authMode === 'register'
        ? { username: authUsername.trim(), email: authEmail.trim(), password: authPassword }
        : { username: authUsername.trim(), password: authPassword }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setAuthToken(data.access_token)
      setAuthUser(data.user)
      localStorage.setItem('nasa_auth_token', data.access_token)
      setAuthPassword('')
      await loadWatchlist(data.access_token)
    } catch (e) {
      setAuthError(e.message || 'Authentication failed')
    } finally {
      setAuthLoading(false)
    }
  }

  async function logout() {
    setAuthToken('')
    setAuthUser(null)
    setWatchlistEntries([])
    setWatchlistIds([])
    localStorage.removeItem('nasa_auth_token')
  }

  async function toggleWatch(item) {
    if (!authToken) {
      setAuthError('Login required to save watchlist.')
      setActiveTab('watch')
      return
    }

    const exists = watchlistIds.includes(item.id)
    try {
      if (exists) {
        await fetch(`${API_BASE}/watchlist/${item.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        })
      } else {
        const payload = {
          asteroid_id: item.id,
          asteroid_name: item.name,
          risk_category: item.risk_category,
          risk_score: item.risk_score,
          close_approach_date: item.close_approach_date,
        }
        const res = await fetch(`${API_BASE}/watchlist`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(await res.text())
      }
      await loadWatchlist(authToken)
    } catch (e) {
      setError(`Watchlist update failed: ${e.message || 'Unknown error'}`)
    }
  }

  useEffect(() => {
    const savedToken = localStorage.getItem('nasa_auth_token')
    if (savedToken) {
      setAuthToken(savedToken)
      fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((me) => {
          if (me) {
            setAuthUser(me)
            loadWatchlist(savedToken)
          } else {
            localStorage.removeItem('nasa_auth_token')
          }
        })
        .catch(() => {
          localStorage.removeItem('nasa_auth_token')
        })
    }
    loadData()
    const poll = setInterval(loadData, REFRESH_INTERVAL_MS)
    return () => clearInterval(poll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData])

  useEffect(() => {
    connectChat()
    return () => {
      shouldReconnectRef.current = false
      clearTimeout(reconnectRef.current)
      clearTimeout(transitionRef.current)
      const socket = socketRef.current
      if (socket) socket.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sendSocket({ type: 'set_name', name: chatName.trim() || 'Pilot' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatName])

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    if (authToken) {
      loadWatchlist(authToken)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken])

  useEffect(() => {
    if (activeTab === 'home') {
      setBgVideoSrc('/home-about-bg.mp4')
      setBgVideoLoop(false)
      setShowBgVideo(true)
      setBgVideoKey((v) => v + 1)
    } else if (activeTab === 'map') {
      setBgVideoSrc('/map-bg.mp4')
      setBgVideoLoop(false)
      setShowBgVideo(true)
      setBgVideoKey((v) => v + 1)
    } else if (activeTab === 'about') {
      setBgVideoSrc('/about-bg.mp4')
      setBgVideoLoop(true)
      setShowBgVideo(true)
      setBgVideoKey((v) => v + 1)
    } else {
      setBgVideoSrc('')
      setBgVideoLoop(false)
      setShowBgVideo(false)
    }
  }, [activeTab])

  const selectedAsteroid = useMemo(
    () => items.find((item) => item.id === selectedAsteroidId) || items[0] || null,
    [items, selectedAsteroidId]
  )
  const topRisk = useMemo(() => items.slice(0, 6), [items])
  const watchItems = useMemo(() => watchlistEntries, [watchlistEntries])
  const alertItems = useMemo(() => items.filter((x) => (x.risk_score || 0) >= alertThreshold), [items, alertThreshold])
  const transitionTitle = pendingTab === 'map' ? 'Launching Live Asteroid Map' : 'Opening Risk Dashboard'

  return (
    <main className="app-shell">
      {showBgVideo && (
        <video
          key={bgVideoKey}
          className="bg-video-layer"
          autoPlay
          muted
          loop={bgVideoLoop}
          playsInline
          onEnded={() => setShowBgVideo(false)}
        >
          <source src={bgVideoSrc} type="video/mp4" />
        </video>
      )}
      <div className="space-bg" />

      <header className="top-nav">
        <div className="brand">
          <h1>Cosmic Watch</h1>
          <p>Public Asteroid Risk Visualization & Alert System</p>
        </div>
        <nav>
          <button className={activeTab === 'home' ? 'active' : ''} onClick={() => selectTab('home')}>Home</button>
          <button className={activeTab === 'map' ? 'active' : ''} onClick={() => selectTab('map')}>Live Asteroid Map</button>
          <button className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => selectTab('dashboard')}>Risk Dashboard</button>
          <button className={activeTab === 'watch' ? 'active' : ''} onClick={() => selectTab('watch')}>Watchlist & Alerts</button>
          <button className={activeTab === 'about' ? 'active' : ''} onClick={() => selectTab('about')}>About / Data Source</button>
        </nav>
      </header>

      {transitionVisible && (
        <section className="transition-overlay">
          <TransitionSpaceScene />
          <div className="transition-copy">
            <p>{transitionTitle}</p>
          </div>
        </section>
      )}

      {activeTab === 'home' && (
        <section className="home panel">
          <div className="hero-copy">
            <h2>A Weather App for Asteroids</h2>
            <p>We convert complex NASA asteroid streams into simple public safety signals with plain-language risk explanations, visual motion paths, and real-time updates every 15 seconds.</p>
            <div className="hero-badges">
              <span>{loading ? 'Updating live feed...' : `Updated ${lastUpdated || 'just now'}`}</span>
              <span>{items.length} tracked objects in current window</span>
            </div>
          </div>
          <div className="home-visual">
            <HomeSpaceScene />
          </div>
        </section>
      )}

      {activeTab === 'map' && (
        <LiveAsteroidMapReal
          items={items}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApplyDateRange={applyDateRange}
          onRefresh={loadData}
        />
      )}

      {activeTab === 'dashboard' && (
        <>
          <section className="panel controls">
            <div className="field">
              <label htmlFor="start">Start Date</label>
              <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="end">End Date</label>
              <input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <button className="btn" onClick={loadData}>{loading ? 'Loading...' : 'Refresh Data'}</button>
          </section>

          {summary && (
            <section className="summary-grid">
              <article className="panel stat"><h3>Today Total</h3><strong>{fmt(summary.total)}</strong></article>
              <article className="panel stat"><h3>High Risk</h3><strong className="txt-high">{fmt(summary.high_risk)}</strong></article>
              <article className="panel stat"><h3>Medium Risk</h3><strong className="txt-medium">{fmt(summary.medium_risk)}</strong></article>
              <article className="panel stat"><h3>Low Risk</h3><strong className="txt-low">{fmt(summary.low_risk)}</strong></article>
            </section>
          )}

          <section className="panel viewer">
            <div className="viewer-left">
              <h3>3D Orbital View</h3>
              <RealOrbitViewer items={items} selectedAsteroidId={selectedAsteroid?.id} />
            </div>
            <div className="viewer-right">
              <div className="field">
                <label htmlFor="asteroid-select">Select Asteroid</label>
                <select id="asteroid-select" value={selectedAsteroid?.id || ''} onChange={(e) => setSelectedAsteroidId(e.target.value)}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>

              {selectedAsteroid && (
                <article className="selected-meta">
                  <h4>{selectedAsteroid.name}</h4>
                  <p>Size: {sizeToHuman(selectedAsteroid.estimated_diameter_m)} ({fmt(selectedAsteroid.estimated_diameter_m)} m)</p>
                  <p>Speed: {fmt(selectedAsteroid.relative_velocity_kps)} km/s</p>
                  <p>Distance: {distanceToHuman(selectedAsteroid.miss_distance_km)} ({fmt(selectedAsteroid.miss_distance_km)} km)</p>
                  <p>Risk Level: {riskTone(selectedAsteroid.risk_score)} ({selectedAsteroid.risk_score}/100)</p>
                  <span className={riskClass(selectedAsteroid.risk_category)}>{selectedAsteroid.risk_category}</span>
                </article>
              )}
            </div>
          </section>

          <section className="panel">
            <h3>Top Risk Objects</h3>
            <div className="list">
              {topRisk.map((a) => (
                <article key={a.id} className="row" onClick={() => setSelectedAsteroidId(a.id)}>
                  <div>
                    <h4>{a.name}</h4>
                    <p>{sizeToHuman(a.estimated_diameter_m)} • {distanceToHuman(a.miss_distance_km)}</p>
                  </div>
                  <div className="row-actions">
                    <span className={riskClass(a.risk_category)}>{a.risk_score}/100</span>
                    <button className="tiny-btn" onClick={(e) => { e.stopPropagation(); toggleWatch(a) }}>
                      {watchlistIds.includes(a.id) ? 'Unwatch' : 'Watch'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {error && <p className="error-text">{error}</p>}
          </section>

          <SimpleCharts items={items} />
        </>
      )}

      {activeTab === 'watch' && (
        <>
          <section className="panel">
            {!authToken && (
              <div className="auth-box">
                <h3>{authMode === 'register' ? 'Register' : 'Login'}</h3>
                <div className="auth-switch">
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
                  <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Register</button>
                </div>
                <div className="auth-fields">
                  <input placeholder="Username" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} />
                  {authMode === 'register' && (
                    <input placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                  )}
                  <input type="password" placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                </div>
                <button className="btn" onClick={submitAuth} disabled={authLoading}>
                  {authLoading ? 'Please wait...' : authMode === 'register' ? 'Create Account' : 'Login'}
                </button>
                {authError && <p className="error-text">{authError}</p>}
              </div>
            )}
            {authToken && authUser && (
              <div className="auth-box">
                <h3>Signed in</h3>
                <p className="muted">User: {authUser.username}</p>
                <button className="btn" onClick={logout}>Logout</button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-head">
              <h2>Watchlist & Alerts</h2>
              <p>Track asteroids and trigger plain-language warnings when risk exceeds your threshold.</p>
            </div>
            <div className="watch-controls">
              <label htmlFor="risk-threshold">Alert threshold: {alertThreshold}/100</label>
              <input
                id="risk-threshold"
                type="range"
                min="30"
                max="90"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(Number(e.target.value))}
              />
            </div>
            <div className="alert-list">
              {alertItems.length === 0 && <p className="muted">No active alerts in this date range.</p>}
              {alertItems.map((a) => (
                <article key={a.id} className="alert-card">
                  <strong>Alert: {a.name}</strong>
                  <p>{sizeToHuman(a.estimated_diameter_m)}, moving at {fmt(a.relative_velocity_kps)} km/s, {distanceToHuman(a.miss_distance_km)}.</p>
                  <span className={riskClass(a.risk_category)}>Risk {a.risk_score}/100</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h3>Your Watchlist</h3>
            <div className="list">
              {watchItems.length === 0 && <p className="muted">No asteroids selected yet. Add from Dashboard.</p>}
              {watchItems.map((a) => (
                <article key={a.asteroid_id} className="row">
                  <div>
                    <h4>{a.asteroid_name}</h4>
                    <p>Closest approach: {a.close_approach_date}</p>
                  </div>
                  <span className={riskClass(a.risk_category)}>{a.risk_score || 0}/100</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="chat-head">
              <h3>Live Community Chat</h3>
              <div className="chat-badges">
                <span className={`chat-pill ${chatStatus === 'Live' ? 'chat-live' : 'chat-offline'}`}>{chatStatus}</span>
                <span className="chat-pill">{activeUsers} online</span>
              </div>
            </div>
            <div className="chat-shell">
              <div className="chat-messages">
                {chatMessages.length === 0 && <p className="chat-empty">No messages yet.</p>}
                {chatMessages.map((msg, idx) => (
                  <article key={`${msg.timestamp || 't'}-${idx}`} className={`chat-row chat-${msg.type || 'system'}`}>
                    <div className="chat-meta">
                      <strong>{msg.user || (msg.type === 'error' ? 'System Error' : 'Mission Control')}</strong>
                      <span>{chatTime(msg.timestamp)}</span>
                    </div>
                    <p>{msg.message}</p>
                  </article>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-compose">
                <div className="field">
                  <label htmlFor="chat-name">Display Name</label>
                  <input id="chat-name" value={chatName} maxLength={24} onChange={(e) => setChatName(e.target.value)} />
                </div>
                <div className="field chat-send">
                  <label htmlFor="chat-input">Message</label>
                  <input
                    id="chat-input"
                    value={chatInput}
                    maxLength={500}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage() }}
                    placeholder="Share observations..."
                  />
                  <button className="btn" onClick={sendChatMessage} disabled={chatStatus !== 'Live'}>Send</button>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {activeTab === 'about' && (
        <section className="panel about">
          <h2>About / Data Source</h2>
          <p>Data source: NASA Near Earth Object Web Service (NeoWs). We do not alter NASA records. We simplify presentation for public understanding.</p>
          <h3>How risk is explained</h3>
          <p>We translate asteroid size, speed, and closest pass distance into a plain-language risk score from 0 to 100. Higher score means higher caution priority.</p>
          <h3>Who this helps</h3>
          <p>Students, researchers, media teams, and the general public who need quick, clear situational awareness rather than technical raw tables.</p>
        </section>
      )}
    </main>
  )
}

export default App
