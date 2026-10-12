// A short beep pattern + buzz for time-up / 5-minutes-left (Slots on staff phones, the #timer screen).
export function alarm(times = 1) {
  try {
    navigator.vibrate?.(Array.from({ length: times * 2 }, (_, i) => (i % 2 ? 150 : 400)))
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'square'; o.frequency.value = 988; g.gain.value = 0.12
      o.connect(g); g.connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.6); o.stop(ctx.currentTime + i * 0.6 + 0.4)
    }
    setTimeout(() => ctx.close(), times * 700 + 200)
  } catch { /* ignore */ }
}

