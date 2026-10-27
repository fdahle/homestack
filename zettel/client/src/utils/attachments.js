// Attachment helpers: id generation, type checks, size formatting, image compression.
// Binary data is stored as CouchDB-native _attachments; the note doc only keeps
// lightweight metadata ({ id, name, type, size }).

export function generateAttachmentId() {
  return 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
}

export function isImageType(type) {
  return typeof type === 'string' && type.startsWith('image/')
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

// Downscale + re-encode an image File/Blob via canvas. Returns a Blob.
// Non-image inputs (or GIFs, which would lose animation) are returned unchanged.
export function compressImage(file, maxDim = 1920, quality = 0.85) {
  if (!isImageType(file.type) || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return Promise.resolve(file)
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width <= maxDim && height <= maxDim) {
        // Still re-encode large-byte PNGs? Keep simple: only resize when needed.
        // Small enough — keep original to avoid needless quality loss.
        if (file.size < 512 * 1024) return resolve(file)
      }
      const scale = Math.min(1, maxDim / Math.max(width, height))
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      // Preserve transparency for PNGs, otherwise JPEG for better compression.
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      canvas.toBlob(
        (blob) => resolve(blob || file),
        outType,
        outType === 'image/jpeg' ? quality : undefined,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}
