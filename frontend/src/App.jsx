import { useEffect, useMemo, useState } from 'react'
import OrbitViewer from './OrbitViewer'
import './styles.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function fmt(n) {
  if (Number.isNaN(Number(n))) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n))
}

function riskClass(category) {
  if (category === 'High') return 'risk risk-high'
  if (category === 'Medium') return 'risk risk-medium'
  return 'risk risk-low'
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateString, days) {
  const d = new Date(dateString)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function App() {
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState(addDays(today(), 2))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [selectedAsteroidId, setSelectedAsteroidId] = useState('')
  const [timelineHours, setTimelineHours] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [feedRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/neo/feed?start_date=${startDate}&end_date=${endDate}`),
        fetch(`${API_BASE}/api/neo/today-summary`)
      ])

      if (!feedRes.ok) {
        const t = await feedRes.text()
        throw new Error(`Feed API failed: ${t}`)
      }
      if (!summaryRes.ok) {
        const t = await summaryRes.text()
        throw new Error(`Summary API failed: ${t}`)
      }

      const feedData = await feedRes.json()
      const summaryData = await summaryRes.json()
      const nextItems = feedData.items || []
      setItems(nextItems)
      setSummary(summaryData)
      if (nextItems.length > 0 && !selectedAsteroidId) {
        setSelectedAsteroidId(nextItems[0].id)
      }
    } catch (e) {
      setError(e.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const topRisk = useMemo(
    () => items.slice(0, 5),
    [items]
  )
  const selectedAsteroid = useMemo(
    () => items.find((item) => item.id === selectedAsteroidId) || items[0] || null,
    [items, selectedAsteroidId]
  )
  const selectedRiskClass = selectedAsteroid ? riskClass(selectedAsteroid.risk_category) : 'risk risk-low'

  return (
    <main className="page">
      <section className="hero card-in">
        <h1>Cosmic Watch</h1>
        <p>Real-time Near-Earth Object monitoring powered by NASA NeoWs.</p>
      </section>

      <section className="panel controls card-in">
        <div className="field">
          <label htmlFor="start">Start date</label>
          <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="end">End date</label>
          <input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button className="btn" onClick={loadData} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </section>

      <section className="panel viewer card-in">
        <div className="viewer-left">
          <div className="viewer-head">
            <h2>Asteroid Approach Viewer</h2>
            <p>Simple 3D orbit to focus risk awareness over astrophysics complexity.</p>
          </div>
          <OrbitViewer asteroid={selectedAsteroid} timelineHours={timelineHours} isPlaying={isPlaying} />
        </div>

        <div className="viewer-right">
          <div className="field">
            <label htmlFor="asteroid-select">Select asteroid</label>
            <select
              id="asteroid-select"
              value={selectedAsteroid?.id || ''}
              onChange={(e) => setSelectedAsteroidId(e.target.value)}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="timeline">Timeline (hours): {timelineHours > 0 ? `+${timelineHours}` : timelineHours}</label>
            <input
              id="timeline"
              type="range"
              min="-12"
              max="12"
              step="1"
              value={timelineHours}
              onChange={(e) => setTimelineHours(Number(e.target.value))}
            />
          </div>

          <div className="inline-actions">
            <button className="btn" onClick={() => setIsPlaying((p) => !p)}>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>

          {selectedAsteroid && (
            <div className="selected-meta">
              <h3>{selectedAsteroid.name}</h3>
              <p>Closest approach: {selectedAsteroid.close_approach_date}</p>
              <p>Diameter: {fmt(selectedAsteroid.estimated_diameter_m)} m</p>
              <p>Velocity: {fmt(selectedAsteroid.relative_velocity_kps)} km/s</p>
              <p>Miss distance: {fmt(selectedAsteroid.miss_distance_km)} km</p>
              <span className={`${selectedRiskClass} ${selectedAsteroid.risk_category === 'High' ? 'pulse' : ''}`}>
                {selectedAsteroid.risk_category} Risk
              </span>
            </div>
          )}
        </div>
      </section>

      {error && <section className="panel error">{error}</section>}

      {summary && (
        <section className="grid card-in">
          <article className="panel stat glass">
            <h3>Today Total</h3>
            <strong className="num">{fmt(summary.total)}</strong>
          </article>
          <article className="panel stat glass">
            <h3>High Risk</h3>
            <strong className="txt-high num">{fmt(summary.high_risk)}</strong>
          </article>
          <article className="panel stat glass">
            <h3>Medium Risk</h3>
            <strong className="txt-medium num">{fmt(summary.medium_risk)}</strong>
          </article>
          <article className="panel stat glass">
            <h3>Low Risk</h3>
            <strong className="txt-low num">{fmt(summary.low_risk)}</strong>
          </article>
        </section>
      )}

      <section className="panel card-in">
        <h2>Top Risk Objects</h2>
        <div className="list">
          {topRisk.map((a) => (
            <article key={a.id} className="row" onClick={() => setSelectedAsteroidId(a.id)}>
              <div>
                <h4>{a.name}</h4>
                <p>Approach: {a.close_approach_date}</p>
              </div>
              <span className={riskClass(a.risk_category)}>{a.risk_category}</span>
            </article>
          ))}
          {topRisk.length === 0 && !loading && <p>No data found for this date range.</p>}
        </div>
      </section>

      <section className="panel card-in">
        <h2>Asteroid Feed</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Diameter (m)</th>
                <th>Velocity (km/s)</th>
                <th>Miss Distance (km)</th>
                <th>Hazardous</th>
                <th>Risk</th>
                <th>3D</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className={selectedAsteroid?.id === a.id ? 'active-row' : ''}>
                  <td>
                    <a href={a.nasa_jpl_url} target="_blank" rel="noreferrer">
                      {a.name}
                    </a>
                  </td>
                  <td>{a.close_approach_date}</td>
                  <td className="num">{fmt(a.estimated_diameter_m)}</td>
                  <td className="num">{fmt(a.relative_velocity_kps)}</td>
                  <td className="num">{fmt(a.miss_distance_km)}</td>
                  <td>{a.is_potentially_hazardous ? 'Yes' : 'No'}</td>
                  <td>
                    <span className={riskClass(a.risk_category)}>
                      {a.risk_category} ({a.risk_score})
                    </span>
                  </td>
                  <td>
                    <button className="tiny-btn" onClick={() => setSelectedAsteroidId(a.id)}>View 3D</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan="8">No asteroid records for selected dates.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
