import { Component } from 'react'

// One screen that throws must not blank the whole app: show a short message with a way out instead.
// `resetKey` (e.g. the open tab) clears the error when it changes, so switching tabs recovers.
export default class ErrorBoundary extends Component {
  state = { error: null, key: this.props.resetKey }
  static getDerivedStateFromError(error) { return { error } }
  static getDerivedStateFromProps(props, state) { return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null }
  componentDidCatch(error) { console.error('Screen crashed:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card" style={{ margin: '24px 0', display: 'grid', gap: 10 }} role="alert">
        <h3 style={{ margin: 0 }}>Something went wrong on this screen</h3>
        <p className="muted small" style={{ margin: 0 }}>Your data is safe. Try another tab, or reload.</p>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn primary" onClick={() => location.reload()}>Reload</button>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    )
  }
}
