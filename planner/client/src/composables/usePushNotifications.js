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

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  const registration = await navigator.serviceWorker.ready
  if (!registration.pushManager) return

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return

  try {
    const vapidPublicKey    = await getVapidPublicKey()
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })

    await fetch('/api/push/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(subscription),
    })
  } catch (err) {
    console.warn('[push] subscribeToPush failed:', err)
  }
}

export async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return

    await subscription.unsubscribe()

    await fetch('/api/push/unsubscribe', { method: 'DELETE' }).catch(() => {})
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
    const registration = await navigator.serviceWorker.ready
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
