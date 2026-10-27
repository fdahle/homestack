/**
 * Composable for managing Web Push subscriptions.
 *
 * The VAPID public key is provided at build time via VITE_VAPID_PUBLIC_KEY.
 * At runtime, it is fetched from GET /api/push/vapid-key as a fallback so
 * the key does not need to be baked into the Docker image.
 */

let cachedVapidKey = null

async function getVapidPublicKey() {
  if (cachedVapidKey) return cachedVapidKey

  // Prefer the build-time env var (available in non-Docker dev builds)
  const envKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (envKey) {
    cachedVapidKey = envKey
    return cachedVapidKey
  }

  // Fallback: fetch from API (Docker / production without build arg)
  const res = await fetch('/api/push/vapid-key')
  if (!res.ok) throw new Error('Could not retrieve VAPID public key from server')
  const { publicKey } = await res.json()
  cachedVapidKey = publicKey
  return cachedVapidKey
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

// `navigator.serviceWorker.ready` never resolves when no service worker is
// active (e.g. the dev server, where the PWA SW is disabled) — which would hang
// the caller and freeze the UI (the "toggle greys out and never comes back"
// bug). Resolve quickly via an existing registration, otherwise race `.ready`
// against a timeout so callers always settle.
async function getRegistration(timeoutMs = 4000) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser.')
  }
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing?.active) return existing
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Service worker is not active yet — push needs the built/installed app (it is disabled on the dev server).')),
      timeoutMs,
    )),
  ])
}

// Current subscription, or null — never hangs.
export async function getPushSubscription() {
  try {
    const registration = await getRegistration()
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

// Subscribes and persists server-side. Throws a descriptive error on failure so
// the UI can show why (instead of silently failing). Returns the subscription.
export async function subscribeToPush() {
  const registration = await getRegistration()
  if (!registration.pushManager) throw new Error('Push notifications are not supported in this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    const err = new Error('Notification permission was not granted.')
    err.code = 'denied'
    throw err
  }

  const vapidPublicKey       = await getVapidPublicKey()
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  })

  const res = await fetch('/api/push/subscribe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(subscription),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Could not save the subscription (HTTP ${res.status}).`)
  }
  return subscription
}

export async function unsubscribeFromPush() {
  let registration
  try { registration = await getRegistration() }
  catch { return } // no active SW → nothing to unsubscribe

  try {
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return
    const { endpoint } = subscription
    await subscription.unsubscribe()
    // Remove only this device's subscription; the user's others stay active.
    await fetch('/api/push/unsubscribe', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ endpoint }),
    }).catch(() => {})
  } catch (err) {
    console.warn('[push] unsubscribeFromPush failed:', err)
  }
}

/**
 * Called on app init. If notification permission is already granted, ensure
 * a push subscription exists (re-subscribes if it was lost, e.g. after a
 * browser update that regenerates SW keys).
 */
export async function syncPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    const registration = await getRegistration()
    const existing     = await registration.pushManager.getSubscription()
    if (existing) return // already subscribed

    // Re-subscribe silently (permission already granted)
    const vapidPublicKey       = await getVapidPublicKey()
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)
    const subscription         = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })

    await fetch('/api/push/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(subscription),
    })
  } catch (err) {
    console.warn('[push] syncPushSubscription failed:', err)
  }
}
