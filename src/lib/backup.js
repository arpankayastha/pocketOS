import { supabase } from './supabase'

// Google Drive backup (Edge Function `backup`). The browser only gets a one-time authorization code from
// Google (scope drive.file: eChopdo sees just the files it creates); the function exchanges it, keeps the
// long-term token server-side, and writes the backups.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '243462550397-r9ri19m26tuo13et7ovv0ru1r82i6tlh.apps.googleusercontent.com'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

let gis
function loadGis() {
  gis ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gis = null; reject(new Error("Couldn't reach Google. Check your connection.")) }
    document.head.appendChild(s)
  })
  return gis
}

export async function requestDriveCode() {
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: CLIENT_ID, scope: SCOPE, ux_mode: 'popup',
      callback: (r) => (r.error ? reject(new Error(r.error === 'access_denied' ? 'Google access was declined.' : `Google sign-in failed (${r.error}).`)) : resolve(r.code)),
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : "Couldn't open Google sign-in. Allow pop-ups and try again.")),
    })
    client.requestCode()
  })
}

export async function backupCall(body) {
  const { data, error } = await supabase.functions.invoke('backup', { body })
  if (error) {
    // The function answers errors as JSON { error }; surface that message.
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* keep generic */ }
    throw new Error(msg)
  }
  return data
}
