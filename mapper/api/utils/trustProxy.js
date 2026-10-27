// TRUST_PROXY is a hop count, true/false, or an Express trust list such as "loopback, 10.0.0.0/8".
// A bare number must become a Number: as a string Express would read "1" as the address 0.0.0.1.
export function parseTrustProxy(value) {
  value = value?.trim() || '1'
  if (/^\d+$/.test(value)) return Number(value)
  return value === 'true' ? true : value === 'false' ? false : value
}
