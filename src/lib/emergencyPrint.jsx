import EmergencyDoc from '../components/EmergencyDoc'

// Same approach as the Will: render into a body-level node, print (→ "Save as PDF"), clean up.
function ensureGujaratiFont() {
  if (document.getElementById('gu-font')) return
  document.head.appendChild(Object.assign(document.createElement('link'), {
    id: 'gu-font', rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+Gujarati:wght@400;600;700&display=swap',
  }))
}

export function printEmergency({ data, linked, live }, fileName = 'eChopdo emergency sheet') {
  ensureGujaratiFont()
  const host = document.createElement('div')
  host.id = 'emergency-print'
  document.body.appendChild(host)
  document.body.classList.add('printing-emergency')
  const prevTitle = document.title
  document.title = fileName
  return new Promise((resolve) => {
    import('react-dom/client').then(async ({ createRoot }) => {
      const root = createRoot(host)
      root.render(<EmergencyDoc data={data} linked={linked} live={live} print />)
      try { await document.fonts.load('16px "Noto Serif Gujarati"'); await document.fonts.ready } catch { /* print anyway */ }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const done = () => {
        window.removeEventListener('afterprint', done)
        root.unmount(); host.remove()
        document.body.classList.remove('printing-emergency')
        document.title = prevTitle
        resolve()
      }
      window.addEventListener('afterprint', done)
      window.print()
      setTimeout(() => { if (document.body.contains(host)) done() }, 60_000)
    })
  })
}
