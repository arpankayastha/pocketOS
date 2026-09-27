// Device-local WebAuthn credentials for fingerprint unlock (independent of Supabase's
// sign-in passkeys). Signatures are never verified server-side: for the Vault, security
// comes from the PRF extension — the authenticator only releases the PRF secret after
// biometric verification, and that secret is what decrypts the vault key. For the
// app lock, a successful user-verified assertion is a local privacy gate only.
import { fromB64Url, randomBytes, toB64Url } from './vaultCrypto'

export function webauthnSupported() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
}

export async function platformAuthenticatorAvailable() {
  if (!webauthnSupported()) return false
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}

function prfResult(cred) {
  const first = cred.getClientExtensionResults?.().prf?.results?.first
  return first ? new Uint8Array(first) : null
}

// Creates a credential on this device. With `prfSalt`, also asks for the PRF extension
// and returns the PRF output (evaluating it with a follow-up assertion if the
// authenticator doesn't return it at creation time). Throws if PRF was needed but unsupported.
export async function createCredential({ name, displayName, prfSalt }) {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'eChopdo', id: location.hostname },
      user: { id: randomBytes(16), name, displayName },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      extensions: prfSalt ? { prf: { eval: { first: prfSalt } } } : undefined,
    },
  })
  const credentialId = toB64Url(new Uint8Array(cred.rawId))
  if (!prfSalt) return { credentialId }

  const ext = cred.getClientExtensionResults?.().prf
  if (!ext?.enabled && !ext?.results) {
    throw new Error("This device's fingerprint unlock doesn't support vault encryption (WebAuthn PRF). Use Chrome on Android, or Safari on iOS 18+.")
  }
  const prf = prfResult(cred) || (await getAssertion({ credentials: [{ credentialId, prfSalt }] })).prf
  if (!prf) throw new Error('This device did not return a fingerprint secret (WebAuthn PRF).')
  return { credentialId, prf }
}

// Asks for a fingerprint for any of `credentials` ([{ credentialId, prfSalt? }]).
// Returns { credentialId, prf } — prf is the secret for whichever credential was used.
export async function getAssertion({ credentials }) {
  const withPrf = credentials.filter((c) => c.prfSalt)
  const cred = await navigator.credentials.get({
    publicKey: {
      rpId: location.hostname,
      challenge: randomBytes(32),
      allowCredentials: credentials.map((c) => ({ type: 'public-key', id: fromB64Url(c.credentialId) })),
      userVerification: 'required',
      timeout: 60_000,
      extensions: withPrf.length ? { prf: { evalByCredential: Object.fromEntries(withPrf.map((c) => [c.credentialId, { first: c.prfSalt }])) } } : undefined,
    },
  })
  return { credentialId: toB64Url(new Uint8Array(cred.rawId)), prf: prfResult(cred) }
}

export function describeWebAuthnError(err) {
  if (err?.name === 'NotAllowedError') return 'Fingerprint prompt was cancelled or timed out.'
  if (err?.name === 'InvalidStateError') return 'This device is already registered.'
  if (err?.name === 'SecurityError') return 'Fingerprint unlock is not allowed on this address.'
  return err?.message || String(err)
}

// A friendly default label for this device's fingerprint unlocker.
export function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This device'
}
