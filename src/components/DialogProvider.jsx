import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DialogContext } from '../lib/dialog'
import { TrashIcon } from '../lib/icons'

export default function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null) // { id, kind, opts, resolve }
  const seq = useRef(0)

  const open = useCallback((kind, opts) => new Promise((resolve) => setCurrent({ id: ++seq.current, kind, opts, resolve })), [])
  const api = useMemo(() => ({
    confirm: (opts) => open('confirm', opts),
    prompt: (opts) => open('prompt', opts),
    alert: (opts) => open('alert', typeof opts === 'string' ? { message: opts } : opts),
  }), [open])

  const close = (value) => { current.resolve(value); setCurrent(null) }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <Dialog key={current.id} kind={current.kind} opts={current.opts} close={close} />}
    </DialogContext.Provider>
  )
}

function Dialog({ kind, opts, close }) {
  const { title, message, label, placeholder, defaultValue = '', danger = kind === 'confirm', cancelLabel = 'Cancel', inputType = 'text' } = opts
  const confirmLabel = opts.confirmLabel || (kind === 'prompt' ? 'Save' : kind === 'alert' ? 'OK' : 'Delete')
  const [value, setValue] = useState(defaultValue)
  const cancelRef = useRef(null)
  const okRef = useRef(null)
  const cancelValue = kind === 'prompt' ? null : kind === 'confirm' ? false : undefined

  useEffect(() => {
    // Destructive confirms focus Cancel so a stray Enter doesn't delete anything.
    if (kind === 'confirm' && danger) cancelRef.current?.focus()
    else if (kind !== 'prompt') okRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && close(cancelValue)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e) {
    e.preventDefault()
    if (kind === 'prompt') { if (value.trim()) close(inputType === 'password' ? value : value.trim()) }
    else close(kind === 'confirm' ? true : undefined)
  }

  return (
    <div className="modal-bg dialog-bg" onMouseDown={() => close(cancelValue)}>
      <form className="card modal dialog" role={kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialog-title"
        onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        {danger && kind === 'confirm' && <span className="dialog-icon" aria-hidden="true"><TrashIcon /></span>}
        <h3 id="dialog-title">{title || (kind === 'alert' ? 'Something went wrong' : kind === 'prompt' ? label : 'Are you sure?')}</h3>
        {message && <p className="muted">{message}</p>}
        {kind === 'prompt' && (
          <label>{title ? label : null}
            <input autoFocus type={inputType} autoComplete={inputType === 'password' ? 'current-password' : 'off'} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
          </label>
        )}
        <div className="actions">
          {kind !== 'alert' && <button type="button" ref={cancelRef} className="btn ghost" onClick={() => close(cancelValue)}>{cancelLabel}</button>}
          <button ref={okRef} className={`btn ${danger && kind === 'confirm' ? 'danger' : 'primary'}`} disabled={kind === 'prompt' && !value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  )
}
