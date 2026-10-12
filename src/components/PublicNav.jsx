import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark, HomeIcon, GamepadIcon, ClockIcon, UsersIcon, UserIcon } from '../lib/icons'
import { isCustomer } from '../lib/mine'

// One navigation for every customer-facing page (home, booking, timer, jobs, events, my account):
// a top bar with the brand and, from 800 px, the page links; on phones the floating pill with labels (as in the app).
const LINKS = [
  { id: 'home', href: '#', label: 'Home', icon: HomeIcon },
  { id: 'book', href: '#book', label: 'Book', icon: GamepadIcon },
  { id: 'timer', href: '#timer', label: 'Timer', icon: ClockIcon },
  { id: 'jobs', href: '#jobs', label: 'Jobs', icon: UsersIcon },
]

export function useCustomerSession() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  return session === undefined ? undefined : isCustomer(session) ? session : null
}

export default function PublicNav({ active }) {
  const customer = useCustomerSession()
  const me = { id: 'me', href: '#me', label: customer ? 'Me' : 'Sign in', icon: UserIcon }
  const avatar = customer?.user.user_metadata?.avatar_url
  return (<>
    <header className="pub-top">
      <a className="brand" href="#"><BrandMark size={26} />GRANDXGAMER</a>
      <nav className="pub-links">
        {LINKS.map((l) => <a key={l.id} href={l.href} className={active === l.id ? 'active' : ''}>{l.label}</a>)}
      </nav>
      <a className={`pub-me ${active === 'me' ? 'active' : ''}`} href="#me">
        {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : <UserIcon />}
        <span>{customer ? (customer.user.user_metadata?.full_name || 'Me').split(' ')[0] : 'Sign in'}</span>
      </a>
    </header>
    <nav className="pub-tabs pill-nav" style={{ '--n': LINKS.length + 1 }}>
      {[...LINKS, me].map((l) => (
        <a key={l.id} href={l.href} className={active === l.id ? 'active' : ''} aria-current={active === l.id ? 'page' : undefined}
          onClick={() => { if (active === l.id) window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
          <l.icon /><span>{l.label}</span>
        </a>
      ))}
    </nav>
  </>)
}
