// TRUST_PROXY is a hop count, true/false, or an Express trust list such as "loopback, 10.0.0.0/8".
// A bare number must become a Number: as a string Express would read "1" as the address 0.0.0.1.
// Unset means no proxy, so a directly reachable app cannot be fooled by a faked X-Forwarded-For.
export function parseTrustProxy(value) {
  value = value?.trim() || 'false'
  if (/^\d+$/.test(value)) return Number(value)
  return value === 'true' ? true : value === 'false' ? false : value
}
