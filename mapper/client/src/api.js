let onUnauthorized = () => {}
export function setUnauthorizedHandler(handler) { onUnauthorized = handler }

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function apiFetch(url, { retryRateLimit = false, onRetry, ...options } = {}) {
  for (;;) {
    const response = await fetch(url, options)
    if (response.status === 429 && retryRateLimit) {
      const header = response.headers.get('Retry-After')
      const delay = Math.max(1000, (Number(header) || 0) * 1000 || Date.parse(header) - Date.now() || 60000)
      onRetry?.(Math.ceil(delay / 1000))
      await wait(delay, options.signal)
      continue
    }
    if (!response.ok) {
      let data
      try { data = await response.json() } catch { /* proxies can return HTML */ }
      if (response.status === 401 && !url.startsWith('/api/auth/') && !url.startsWith('/api/public/')) onUnauthorized()
      throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status, requiresPassword: data?.requiresPassword, meta: data?.meta })
    }
    return response
  }
}

export async function apiJson(url, options) {
  const response = await apiFetch(url, options)
  try { return await response.json() } catch { throw new Error('The server returned an invalid response. Please retry.') }
}

export async function apiList(url, options) {
  const data = await apiJson(url, options)
  if (!Array.isArray(data)) throw new Error('The server returned an invalid list. Please retry.')
  return data
}
