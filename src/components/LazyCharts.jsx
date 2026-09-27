import { lazy, Suspense } from 'react'

const charts = () => import('./Charts')
const Trend = lazy(() => charts().then((m) => ({ default: m.TrendChart })))
const Donut = lazy(() => charts().then((m) => ({ default: m.DonutChart })))

// Same-size placeholder while the chart chunk loads, so the layout doesn't jump.
const Hold = ({ height }) => <div className="skel" style={{ height, borderRadius: 12 }} />

export const TrendChart = (p) => <Suspense fallback={<Hold height={p.height || 260} />}><Trend {...p} /></Suspense>
export const DonutChart = (p) => <Suspense fallback={<Hold height={p.height || 220} />}><Donut {...p} /></Suspense>
