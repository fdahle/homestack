// Files picked or pasted into a note. Photos from a phone are often 4000 px and 5 MB: they're
// made smaller (longest side 2400 px, JPEG) before they're stored, which keeps the device's copy
// and the upload small. GIFs (may move), SVGs and small pictures stay as they are.

const MAX_SIDE = 2400;
const SHRINK = /^image\/(jpeg|png|webp|heic|heif|avif)$/;

async function imageSize(blob) {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function named(file) {
  if (file.name) return file.name;
  // Pasted pictures have no name
  const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/\+.*/, '');
  return `${new Date().toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '-')}.${ext}`;
}

// → { blob, name, width?, height? }
export async function prepareFile(file) {
  const name = named(file);
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return { blob: file, name };
  if (!SHRINK.test(file.type)) {
    try {
      return { blob: file, name, ...(await imageSize(file)) };
    } catch {
      return { blob: file, name };
    }
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { blob: file, name }; // a format this browser can't draw (HEIC on most): keep it as it is
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  if (scale === 1 && file.size < 1_500_000 && file.type !== 'image/heic' && file.type !== 'image/heif') {
    bitmap.close();
    return { blob: file, name, width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob || blob.size >= file.size) return { blob: file, name, width, height };
  return { blob, name: name.replace(/\.[^.]+$/, '') + '.jpg', width, height };
}

export const isImage = (file) => /^image\/(png|jpeg|gif|webp|avif)$/.test(file.type);

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.0', '')} MB`;
}
