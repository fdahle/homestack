// fetch() + JSON parsing under one hard deadline: some servers accept the connection and then never
// answer, which would otherwise hang the caller forever. Aborting `signal` rejects with an AbortError
// (callers treat that as a silent cancel); the deadline rejects with a TimeoutError; a non-2xx answer
// rejects with an Error carrying `status`.
export async function fetchJson(url, { signal, timeoutMs, label = 'Request', ...init } = {}) {
  signal?.throwIfAborted()
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  // setTimeout(fn, undefined) fires at once, so there is no deadline unless one is given.
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ctrl.abort() }, timeoutMs) : null
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) throw Object.assign(new Error(`${label} ${res.status}`), { status: res.status })
    return await res.json()
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (timedOut) throw new DOMException(`${label} timed out after ${timeoutMs / 1000}s`, 'TimeoutError')
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
