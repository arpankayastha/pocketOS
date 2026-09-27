import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, moneyShort } from '../lib/format'

// Recharts lives only in this file, which is lazy-loaded (see LazyCharts.jsx), so the
// ~350 kB chart library never delays the first paint.
const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8 }

// Income vs expense bars; rows with `plan: true` are drawn faded.
export function TrendChart({ data, height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 8, right: 8 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
        <XAxis dataKey="month" interval={0} tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={moneyShort} tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={64} />
        <Tooltip formatter={(v) => money(v)} cursor={{ fill: 'var(--card-2)' }} contentStyle={tooltipStyle} />
        <Legend />
        {['Income', 'Expense'].map((key) => (
          <Bar key={key} dataKey={key} fill={key === 'Income' ? 'var(--pos)' : 'var(--neg)'} radius={[4, 4, 0, 0]} maxBarSize={48}>
            {data.map((d) => <Cell key={d.month} fillOpacity={d.plan ? 0.45 : 1} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// Donut: data = [{ key, name, value, color }].
export function DonutChart({ data, height = 220, inner = 55, outer = 90 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={inner} outerRadius={outer} paddingAngle={2}>
          {data.map((d) => <Cell key={d.key} fill={d.color} stroke="var(--card)" strokeWidth={2} />)}
        </Pie>
        <Tooltip formatter={(v) => money(v)} contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  )
}
