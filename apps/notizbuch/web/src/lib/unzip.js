// Reading a ZIP in the browser, without a library: the central directory at the end says
// what's inside, and each entry is read (and inflated) only when it is opened, so a large
// Takeout archive is never in memory as a whole. Handles ZIP64 (archives over 4 GB) and the
// two methods ZIPs use in practice: stored and deflated.

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class ZipError extends Error {}

const bytes = async (blob, start, end) => new DataView(await blob.slice(start, end).arrayBuffer());
const u64 = (view, at) => Number(view.getBigUint64(at, true));

// The end of the central directory: where it starts, how long it is
async function findDirectory(blob) {
  // The end record is 22 bytes plus a comment of up to 65535
  const tailStart = Math.max(0, blob.size - 22 - 65535);
  const tail = await bytes(blob, tailStart, blob.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError('not_zip');
  let count = tail.getUint16(at + 10, true);
  let size = tail.getUint32(at + 12, true);
  let offset = tail.getUint32(at + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    // ZIP64: a locator right before the end record points to the bigger end record
    const locatorAt = tailStart + at - 20;
    const locator = locatorAt >= 0 ? await bytes(blob, locatorAt, locatorAt + 20) : null;
    if (!locator || locator.getUint32(0, true) !== EOCD64_LOCATOR) throw new ZipError('not_zip');
    const recordAt = u64(locator, 8);
    const record = await bytes(blob, recordAt, recordAt + 56);
    if (record.getUint32(0, true) !== EOCD64) throw new ZipError('not_zip');
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  }
  return { count, size, offset };
}

// → [{ name, size, open() → Promise<Blob> }] (folders left out)
export async function readZip(blob) {
  if (blob.size < 22) throw new ZipError('not_zip');
  const dir = await findDirectory(blob);
  const view = await bytes(blob, dir.offset, dir.offset + dir.size);
  const utf8 = new TextDecoder();
  const entries = [];
  let p = 0;
  for (let i = 0; i < dir.count; i++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== CENTRAL) throw new ZipError('bad_zip');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    let compressed = view.getUint32(p + 20, true);
    let size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    let local = view.getUint32(p + 42, true);
    const name = utf8.decode(new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLength));

    // ZIP64 sizes and offset live in an extra field, in this order, for the ones that didn't fit
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = view.getUint16(e, true);
      const length = view.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64(view, q);
          q += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = u64(view, q);
          q += 8;
        }
        if (local === 0xffffffff) local = u64(view, q);
      }
      e += 4 + length;
    }
    p = extraEnd + commentLength;

    if (name.endsWith('/')) continue;
    entries.push({
      name,
      size,
      open: () => openEntry(blob, { name, flags, method, compressed, local }),
    });
  }
  return entries;
}

async function openEntry(blob, { name, flags, method, compressed, local }) {
  if (flags & 1) throw new ZipError('encrypted');
  const header = await bytes(blob, local, local + 30);
  if (header.getUint32(0, true) !== LOCAL) throw new ZipError('bad_zip');
  // The local header may have its own name and extra lengths, different from the central one
  const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = blob.slice(start, start + compressed);
  if (method === 0) return data;
  if (method !== 8) throw new ZipError('unsupported');
  const inflated = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(inflated).blob();
}

export const isZip = (file) => /\.zip$/i.test(file.name) || /zip/.test(file.type);
