// Shimmering placeholders shown until a screen's first data load finishes, in the same
// layout as the real content — so the app never flashes ₹0.00 or "nothing yet" on open.

export function DashboardSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading">
      <div className="toolbar"><div className="skel" style={{ width: 150, height: 28 }} /></div>
      <div className="tiles">
        {[0, 1, 2, 3].map((i) => (
          <div className="card tile" key={i}><div className="skel" style={{ width: '45%', height: 12 }} /><div className="skel" style={{ width: '75%', height: 22 }} /></div>
        ))}
      </div>
      <div className="grid2">
        <div className="card"><div className="skel" style={{ width: '50%', height: 16, marginBottom: 16 }} /><div className="skel" style={{ height: 220 }} /></div>
        <div className="card"><div className="skel" style={{ width: '50%', height: 16, marginBottom: 16 }} /><div className="skel" style={{ height: 220 }} /></div>
      </div>
    </section>
  )
}

export function ListSkeleton({ rows = 6 }) {
  return (
    <section aria-busy="true" aria-label="Loading">
      <div className="toolbar"><div className="skel" style={{ width: 150, height: 28 }} /></div>
      <div className="card list"><SkeletonRows rows={rows} /></div>
    </section>
  )
}

// Just the rows, for inside an existing list card.
export function SkeletonRows({ rows = 6 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => (
          <div className="txn" key={i}>
            <div className="skel" style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0 }} />
            <div className="grow" style={{ display: 'grid', gap: 6 }}>
              <div className="skel" style={{ width: `${55 - (i % 3) * 10}%`, height: 14 }} />
              <div className="skel" style={{ width: '30%', height: 10 }} />
            </div>
            <div className="skel" style={{ width: 70, height: 14 }} />
          </div>
        ))}
    </div>
  )
}

export function GateSkeleton() {
  return (
    <div className="card gate" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ width: 34, height: 34, justifySelf: 'center' }} />
      <div className="skel" style={{ width: '60%', height: 22, justifySelf: 'center' }} />
      <div className="skel" style={{ height: 44 }} />
      <div className="skel" style={{ height: 44 }} />
    </div>
  )
}
