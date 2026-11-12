// Detail-sheet header: a bordered back square, a small centred title and one optional action.
export default function SheetHead({ title, onBack, right }) {
  return (
    <div className="sh">
      <button type="button" className="sh-btn" aria-label="Back" onClick={onBack}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span className="sh-title">{title}</span>
      <div className="sh-r">{right}</div>
    </div>
  )
}
