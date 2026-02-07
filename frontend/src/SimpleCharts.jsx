import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'

const RISK_COLORS = {
  High: '#ff6b6b',
  Medium: '#ffc86a',
  Low: '#59dda9',
}

function num(value) {
  const v = Number(value)
  return Number.isFinite(v) ? v : 0
}

function buildCategoryData(items) {
  const categories = { Low: 0, Medium: 0, High: 0 }
  items.forEach((item) => {
    const key = item.risk_category || 'Low'
    if (!(key in categories)) categories[key] = 0
    categories[key] += 1
  })
  return Object.entries(categories).map(([name, value]) => ({ name, value }))
}

function buildLineData(items) {
  return items.slice(0, 12).map((item, idx) => ({
    index: idx + 1,
    score: num(item.risk_score),
    velocity: Math.round(num(item.relative_velocity_kph)),
    diameter: num(item.estimated_diameter_km),
  }))
}

function buildScatterData(items) {
  return items.slice(0, 25).map((item) => ({
    x: num(item.estimated_diameter_km),
    y: Math.round(num(item.miss_distance_km)),
    z: num(item.risk_score),
  }))
}

function buildRadarData(items) {
  const count = Math.max(1, items.length)
  const avg = (getter) => items.reduce((s, x) => s + num(getter(x)), 0) / count
  return [
    { metric: 'Risk', value: avg((x) => x.risk_score) },
    { metric: 'Speed', value: avg((x) => x.relative_velocity_kps) * 3 },
    { metric: 'Size', value: avg((x) => x.estimated_diameter_km) * 500 },
    { metric: 'Nearness', value: Math.max(0, 100 - (avg((x) => x.miss_distance_km) / 1000000)) },
  ]
}

function SimpleCharts({ items }) {
  const categoryData = buildCategoryData(items)
  const lineData = buildLineData(items)
  const scatterData = buildScatterData(items)
  const radarData = buildRadarData(items)

  return (
    <section className="panel">
      <h3>Simple Graph Insights</h3>
      <div className="graphs-grid">
        <article className="graph-card">
          <h4>Risk Category (Bar)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,180,230,0.15)" />
              <XAxis dataKey="name" stroke="#b9d6fb" />
              <YAxis stroke="#b9d6fb" />
              <Tooltip />
              <Bar dataKey="value">
                {categoryData.map((entry) => (
                  <Cell key={entry.name} fill={RISK_COLORS[entry.name] || '#7fb3ff'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="graph-card">
          <h4>Risk Score Trend (Line)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,180,230,0.15)" />
              <XAxis dataKey="index" stroke="#b9d6fb" />
              <YAxis stroke="#b9d6fb" />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="#66c3ff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="graph-card">
          <h4>Velocity Profile (Area)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,180,230,0.15)" />
              <XAxis dataKey="index" stroke="#b9d6fb" />
              <YAxis stroke="#b9d6fb" />
              <Tooltip />
              <Area type="monotone" dataKey="velocity" stroke="#59dda9" fill="#59dda966" />
            </AreaChart>
          </ResponsiveContainer>
        </article>

        <article className="graph-card">
          <h4>Risk Share (Pie)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40}>
                {categoryData.map((entry) => (
                  <Cell key={entry.name} fill={RISK_COLORS[entry.name] || '#7fb3ff'} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </article>

        <article className="graph-card">
          <h4>Size vs Distance (Scatter)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,180,230,0.15)" />
              <XAxis dataKey="x" name="diameter_km" stroke="#b9d6fb" />
              <YAxis dataKey="y" name="miss_km" stroke="#b9d6fb" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={scatterData} fill="#ffc86a" />
            </ScatterChart>
          </ResponsiveContainer>
        </article>

        <article className="graph-card">
          <h4>Overall Risk Shape (Radar)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(140,180,230,0.2)" />
              <PolarAngleAxis dataKey="metric" stroke="#b9d6fb" />
              <Radar name="Metrics" dataKey="value" stroke="#66c3ff" fill="#66c3ff55" fillOpacity={0.7} />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        </article>
      </div>
    </section>
  )
}

export default SimpleCharts
