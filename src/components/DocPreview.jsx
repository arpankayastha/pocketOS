import { useEffect, useRef, useState } from 'react'
import { fetchDriveFile } from '../lib/drive'
import { linkHref } from '../lib/docs'

// Full-screen preview of a Drive file: images as they are, PDFs (and exported Google Docs) drawn page
// by page with pdf.js, because Chrome on Android can't show a PDF inside a page. Other types
// (Word, Excel…) fall back to Open in Drive. The file only exists in memory while this is open.
export default function DocPreview({ id, link, title, onClose }) {
  const [state, setState] = useState({ status: 'loading' }) // loading | image | pdf | other | error
  const pagesRef = useRef(null)

  useEffect(() => {
    let alive = true
    let url = null
    ;(async () => {
      try {
        const { blob, mime } = await fetchDriveFile(id)
        if (!alive) return
        if (mime.startsWith('image/')) { url = URL.createObjectURL(blob); setState({ status: 'image', url }) }
        else if (mime === 'application/pdf') {
          setState({ status: 'pdf' })
          const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default
          const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
          const box = pagesRef.current
          const width = Math.min(box.clientWidth, 900)
          const ratio = window.devicePixelRatio || 1
          for (let n = 1; n <= pdf.numPages && alive; n++) {
            const page = await pdf.getPage(n)
            const base = page.getViewport({ scale: 1 })
            const vp = page.getViewport({ scale: (width / base.width) * ratio })
            const canvas = document.createElement('canvas')
            canvas.width = vp.width; canvas.height = vp.height
            canvas.style.width = `${width}px`
            canvas.className = 'doc-page'
            box.appendChild(canvas)
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
          }
        } else setState({ status: 'other' })
      } catch (err) { if (alive) setState({ status: 'error', message: err.message }) }
    })()
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [id])

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal sheet doc-preview" onMouseDown={(e) => e.stopPropagation()}>
        <div className="view-head">
          <h3 className="grow ellipsis">{title}</h3>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="doc-body">
          {state.status === 'loading' && <p className="muted pad">Fetching from Google Drive…</p>}
          {state.status === 'image' && <img className="doc-img" src={state.url} alt={title} />}
          {state.status === 'pdf' && <div ref={pagesRef} className="doc-pages" />}
          {state.status === 'other' && <p className="muted pad">This kind of file (Word, Excel…) can't be shown here. Open it in Google Drive.</p>}
          {state.status === 'error' && <div className="alert error">{state.message}</div>}
        </div>
        <div className="actions">
          <a className="btn primary" href={linkHref(link)} target="_blank" rel="noopener noreferrer">Open in Google Drive</a>
        </div>
      </div>
    </div>
  )
}
