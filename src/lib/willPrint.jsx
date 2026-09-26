import { useEffect } from 'react'
import { guDigits } from './willText'
import WillDocument from '../components/will/WillDocument'

// Gujarati font for the will, loaded only when the Will module is used.
export function useGujaratiFont() {
  useEffect(() => {
    if (document.getElementById('gu-font')) return
    const link = Object.assign(document.createElement('link'), {
      id: 'gu-font', rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+Gujarati:wght@400;600;700&display=swap',
    })
    document.head.appendChild(link)
  }, [])
}

// Renders the will into a body-level node, prints it (→ "Save as PDF"), then cleans up.
// The browser lays out Gujarati correctly; PDF libraries in JS generally don't.
export function printWill(doc, { stamp, fileName }) {
  const host = document.createElement('div')
  host.id = 'will-print'
  document.body.appendChild(host)
  document.body.classList.add('printing-will')
  const g = doc.settings.gujaratiDigits
  const style = g ? 'gujarati' : 'decimal'
  const prevTitle = document.title
  document.title = fileName

  return new Promise((resolve) => {
    import('react-dom/client').then(async ({ createRoot }) => {
      const root = createRoot(host)
      root.render(<>
        <style>{`@page { size: A4; margin: 18mm 16mm 22mm;
          @bottom-left { content: "વસિયત કરનારની સહી: ____________"; font: 9pt 'Noto Serif Gujarati', serif; }
          @bottom-center { content: "પાનું " counter(page, ${style}) " / " counter(pages, ${style}); font: 9pt 'Noto Serif Gujarati', serif; }
          @bottom-right { content: "${g ? guDigits(stamp) : stamp}"; font: 9pt 'Noto Serif Gujarati', serif; } }`}</style>
        <WillDocument doc={doc} stamp={stamp} />
      </>)
      try { await document.fonts.load('16px "Noto Serif Gujarati"'); await document.fonts.ready } catch { /* print anyway */ }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const done = () => {
        window.removeEventListener('afterprint', done)
        root.unmount(); host.remove()
        document.body.classList.remove('printing-will')
        document.title = prevTitle
        resolve()
      }
      window.addEventListener('afterprint', done)
      window.print()
      // Some mobile browsers don't fire afterprint; clean up anyway.
      setTimeout(() => { if (document.body.contains(host)) done() }, 60_000)
    })
  })
}
