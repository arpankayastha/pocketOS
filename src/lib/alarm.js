// Beep + buzz for 5-minutes-left / time-up (every Shop tab on staff phones and the PC, and the #timer screen).
// Browsers only play sound after the page has been tapped, so one shared AudioContext is unlocked on the first
// tap / key press and kept; each alarm resumes it if the browser suspended it.
let ctx = null
function context() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { ctx = null } }
  return ctx
}
if (typeof document !== 'undefined') {
  const unlock = () => { const c = context(); c?.resume?.().catch(() => {}) }
  document.addEventListener('pointerdown', unlock, { capture: true })
  document.addEventListener('keydown', unlock, { capture: true })
}

export function alarm(times = 1) {
  try { navigator.vibrate?.(Array.from({ length: times * 2 }, (_, i) => (i % 2 ? 150 : 400))) } catch { /* ignore */ }
  const c = context()
  if (!c) return
  const play = () => {
    // two-tone beeps, loud enough to hear across the café
    for (let i = 0; i < times; i++) {
      for (const [k, f] of [[0, 988], [1, 1319]]) {
        const o = c.createOscillator(), g = c.createGain()
        const t = c.currentTime + i * 0.7 + k * 0.2
        o.type = 'square'; o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
        o.connect(g); g.connect(c.destination)
        o.start(t); o.stop(t + 0.2)
      }
    }
  }
  if (c.state === 'suspended') c.resume().then(play, () => {}); else play()
}
