import { useState } from 'react'
import { copySecret, generatePassword } from '../lib/vaultTools'
import { CopyIcon, DiceIcon } from '../lib/icons'
import { StrengthMeter } from './VaultGate'

export default function PasswordGenerator() {
  const [opts, setOpts] = useState({ length: 20, lower: true, upper: true, digits: true, symbols: true })
  const [pw, setPw] = useState(() => generatePassword(opts))
  const [copied, setCopied] = useState(false)

  const update = (next) => { setOpts(next); setPw(generatePassword(next)); setCopied(false) }

  async function copy() {
    try { await copySecret(pw); setCopied(true) } catch { /* clipboard blocked */ }
  }

  return (
    <section className="card generator">
      <h3>Password generator</h3>
      <div className="generated mono">{pw}</div>
      <StrengthMeter password={pw} />
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" onClick={() => update(opts)}><DiceIcon /> New</button>
        <button className="btn primary" onClick={copy}><CopyIcon /> {copied ? 'Copied — clears in 30s' : 'Copy'}</button>
      </div>
      <label>Length: <b className="mono">{opts.length}</b>
        <input type="range" min={8} max={64} value={opts.length} onChange={(e) => update({ ...opts, length: Number(e.target.value) })} />
      </label>
      <div className="checks">
        {[['lower', 'a–z'], ['upper', 'A–Z'], ['digits', '0–9'], ['symbols', '!@#$']].map(([k, label]) => (
          <label className="check" key={k}>
            <input type="checkbox" checked={opts[k]} disabled={opts[k] && Object.entries(opts).filter(([key, v]) => key !== 'length' && v).length === 1}
              onChange={(e) => update({ ...opts, [k]: e.target.checked })} /> {label}
          </label>
        ))}
      </div>
      <p className="muted small">Look-alike characters (l, 1, I, O, 0) are left out so passwords are easy to read and type.</p>
    </section>
  )
}
