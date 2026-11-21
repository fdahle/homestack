import { isIPv6 } from 'node:net'

// Rate-limit key for a client address. One IPv6 subscriber usually holds a whole /64, so keying on
// the full address would let a client rotate addresses past every per-IP limit.
export function clientKey(ip = '') {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) return mapped[1]
  const address = ip.split('%')[0]
  if (!isIPv6(address)) return ip
  const groups = part => part ? part.split(':') : []
  const size = list => list.reduce((n, group) => n + (group.includes('.') ? 2 : 1), 0)
  const [head, tail] = address.split('::').map(groups)
  const full = [...head, ...Array(8 - size(head) - size(tail ?? [])).fill('0'), ...tail ?? []]
  return full.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':') + '::/64'
}
