// navigator.clipboard only exists on HTTPS/localhost; fall back for plain-HTTP LAN setups.
export async function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true })
  area.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('Copy failed')
}
