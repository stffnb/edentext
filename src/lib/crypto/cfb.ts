// The compound file an encrypted OOXML document is wrapped in (MS-CFB). Only what
// that wrapper needs: a flat set of streams, no storages, no timestamps.

import { encryptionError, UNSUPPORTED_ENCRYPTION } from './errors';

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const SECTOR = 512;
const MINI_SECTOR = 64;
// A stream shorter than this lives in the mini stream, which is itself one stream.
const MINI_CUTOFF = 4096;
const PER_SECTOR = SECTOR / 4;
const DIR_PER_SECTOR = SECTOR / 128;
const HEADER_DIFAT = 109;
const DIFAT_PER_SECTOR = PER_SECTOR - 1;

const DIFSECT = 0xfffffffc;
const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

type Stream = [name: string, data: Uint8Array];

function chunks(data: Uint8Array, size: number): number {
  return Math.ceil(data.length / size);
}

function padTo(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(chunks(data, size) * size);
  out.set(data);
  return out;
}

// CFB orders directory entries by name length first, then by upper-cased UTF-16.
function compareNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  const [x, y] = [a.toUpperCase(), b.toUpperCase()];
  return x < y ? -1 : x > y ? 1 : 0;
}

export function writeCfb(streams: Stream[]): Uint8Array {
  const big = streams.filter(([, d]) => d.length >= MINI_CUTOFF);
  const small = streams.filter(([, d]) => d.length > 0 && d.length < MINI_CUTOFF);

  // The mini stream is the small streams laid end to end on mini-sector boundaries.
  const miniStart = new Map<string, number>();
  let miniSectors = 0;
  for (const [name, data] of small) {
    miniStart.set(name, miniSectors);
    miniSectors += chunks(data, MINI_SECTOR);
  }
  const miniStream = new Uint8Array(miniSectors * MINI_SECTOR);
  for (const [name, data] of small) miniStream.set(data, miniStart.get(name)! * MINI_SECTOR);

  const miniFatSectors = Math.ceil(miniSectors / PER_SECTOR) || 0;
  const dirSectors = Math.ceil((streams.length + 1) / DIR_PER_SECTOR);
  const miniStreamSectors = chunks(miniStream, SECTOR);
  const bigSectors = big.reduce((n, [, d]) => n + chunks(d, SECTOR), 0);
  const base = bigSectors + miniStreamSectors + miniFatSectors + dirSectors;

  // The FAT describes the file including itself, so its size is a fixed point.
  let fatSectors = 1;
  let difatSectors = 0;
  for (let i = 0; i < 8; i++) {
    const total = base + fatSectors + difatSectors;
    const nextFat = Math.max(1, Math.ceil(total / PER_SECTOR));
    const nextDifat = nextFat > HEADER_DIFAT ? Math.ceil((nextFat - HEADER_DIFAT) / DIFAT_PER_SECTOR) : 0;
    if (nextFat === fatSectors && nextDifat === difatSectors) break;
    fatSectors = nextFat;
    difatSectors = nextDifat;
  }

  const totalSectors = base + fatSectors + difatSectors;
  const fat = new Uint32Array(fatSectors * PER_SECTOR).fill(FREESECT);
  const file = new Uint8Array(SECTOR * (1 + totalSectors));
  const view = new DataView(file.buffer);

  // Sectors are handed out in the order they are written: big streams, the mini
  // stream, the MiniFAT, the directory, then the FAT and its DIFAT.
  let next = 0;
  const place = (data: Uint8Array): number => {
    const start = next;
    const padded = padTo(data, SECTOR);
    file.set(padded, SECTOR * (1 + start));
    const count = padded.length / SECTOR;
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? ENDOFCHAIN : start + i + 1;
    next += count;
    return count ? start : ENDOFCHAIN;
  };

  const bigStart = new Map<string, number>();
  for (const [name, data] of big) bigStart.set(name, place(data));
  const miniStreamStart = miniStream.length ? place(miniStream) : ENDOFCHAIN;

  const miniFat = new Uint32Array(miniFatSectors * PER_SECTOR).fill(FREESECT);
  let mini = 0;
  for (const [, data] of small) {
    const count = chunks(data, MINI_SECTOR);
    for (let i = 0; i < count; i++) miniFat[mini + i] = i === count - 1 ? ENDOFCHAIN : mini + i + 1;
    mini += count;
  }
  const miniFatStart = miniFatSectors ? place(new Uint8Array(miniFat.buffer)) : ENDOFCHAIN;

  const directory = new Uint8Array(dirSectors * SECTOR);
  const dirView = new DataView(directory.buffer);
  const order = streams.map((_, i) => i + 1).sort((a, b) => compareNames(streams[a - 1][0], streams[b - 1][0]));
  // A balanced tree over the sorted entries; every node black, which readers accept.
  const build = (lo: number, hi: number): number => {
    if (lo > hi) return FREESECT;
    const mid = (lo + hi) >> 1;
    const at = order[mid];
    dirView.setUint32(at * 128 + 68, build(lo, mid - 1), true);
    dirView.setUint32(at * 128 + 72, build(mid + 1, hi), true);
    return at;
  };

  const entry = (index: number, name: string, type: number, start: number, size: number) => {
    const off = index * 128;
    for (let i = 0; i < name.length; i++) dirView.setUint16(off + i * 2, name.charCodeAt(i), true);
    dirView.setUint16(off + 64, (name.length + 1) * 2, true);
    directory[off + 66] = type;
    directory[off + 67] = 1; // black
    dirView.setUint32(off + 76, FREESECT, true); // no child until the root gets one
    dirView.setUint32(off + 116, start, true);
    dirView.setBigUint64(off + 120, BigInt(size), true);
  };

  streams.forEach(([name, data], i) => {
    const start = data.length === 0 ? ENDOFCHAIN
      : data.length >= MINI_CUTOFF ? bigStart.get(name)!
      : miniStart.get(name)!;
    entry(i + 1, name, 2, start, data.length);
  });
  // The root entry owns the mini stream, and its size is the mini stream's.
  entry(0, 'Root Entry', 5, miniStreamStart, miniStream.length);
  dirView.setUint32(68, FREESECT, true);
  dirView.setUint32(72, FREESECT, true);
  dirView.setUint32(76, build(0, order.length - 1), true);
  for (let i = streams.length + 1; i < dirSectors * DIR_PER_SECTOR; i++) {
    dirView.setUint32(i * 128 + 68, FREESECT, true);
    dirView.setUint32(i * 128 + 72, FREESECT, true);
    dirView.setUint32(i * 128 + 76, FREESECT, true);
  }
  const dirStart = place(directory);

  const fatStart = next;
  for (let i = 0; i < fatSectors; i++) fat[fatStart + i] = FATSECT;
  const difatStart = fatStart + fatSectors;
  for (let i = 0; i < difatSectors; i++) fat[difatStart + i] = DIFSECT;
  file.set(new Uint8Array(fat.buffer), SECTOR * (1 + fatStart));

  // The DIFAT lists the FAT sectors: the first 109 in the header, the rest in a chain.
  for (let i = 0; i < difatSectors; i++) {
    const off = SECTOR * (1 + difatStart + i);
    for (let j = 0; j < DIFAT_PER_SECTOR; j++) {
      const fatIndex = HEADER_DIFAT + i * DIFAT_PER_SECTOR + j;
      view.setUint32(off + j * 4, fatIndex < fatSectors ? fatStart + fatIndex : FREESECT, true);
    }
    view.setUint32(off + SECTOR - 4, i + 1 < difatSectors ? difatStart + i + 1 : ENDOFCHAIN, true);
  }

  file.set(SIGNATURE);
  view.setUint16(24, 0x003e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, fatSectors, true);
  view.setUint32(48, dirStart, true);
  view.setUint32(56, MINI_CUTOFF, true);
  view.setUint32(60, miniFatStart, true);
  view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, difatSectors ? difatStart : ENDOFCHAIN, true);
  view.setUint32(72, difatSectors, true);
  for (let i = 0; i < HEADER_DIFAT; i++) {
    view.setUint32(76 + i * 4, i < fatSectors ? fatStart + i : FREESECT, true);
  }
  return file;
}

export function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function readCfb(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!isCfb(bytes)) throw encryptionError(UNSUPPORTED_ENCRYPTION);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sector = 1 << view.getUint16(30, true);
  const miniSector = 1 << view.getUint16(32, true);
  const cutoff = view.getUint32(56, true);
  const perSector = sector / 4;
  const at = (index: number): number => sector * (1 + index);
  const read = (index: number): Uint8Array => bytes.subarray(at(index), at(index) + sector);

  // The DIFAT names the FAT sectors: 109 in the header, the rest in their own chain.
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = view.getUint32(76 + i * 4, true);
    if (id < FREESECT - 3) fatSectorIds.push(id);
  }
  let difat = view.getUint32(68, true);
  for (let guard = 0; difat < FREESECT - 3 && guard < 1024; guard++) {
    const base = at(difat);
    for (let j = 0; j < perSector - 1; j++) {
      const id = view.getUint32(base + j * 4, true);
      if (id < FREESECT - 3) fatSectorIds.push(id);
    }
    difat = view.getUint32(base + sector - 4, true);
  }

  const fat = new Uint32Array(fatSectorIds.length * perSector);
  fatSectorIds.forEach((id, i) => {
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = view.getUint32(at(id) + j * 4, true);
  });

  const chain = (start: number): number[] => {
    const out: number[] = [];
    for (let s = start; s < FREESECT - 3 && out.length <= fat.length; s = fat[s]) out.push(s);
    return out;
  };
  const streamOf = (start: number, size: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(chain(start).length * sector);
    chain(start).forEach((s, i) => out.set(read(s), i * sector));
    return out.subarray(0, size);
  };

  const directory = streamOf(view.getUint32(48, true), Number.MAX_SAFE_INTEGER);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const count = Math.floor(directory.length / 128);

  let miniStream: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  for (let i = 0; i < count; i++) {
    if (directory[i * 128 + 66] === 5) {
      miniStream = streamOf(dir.getUint32(i * 128 + 116, true), Number(dir.getBigUint64(i * 128 + 120, true)));
      break;
    }
  }
  const miniFat = new Uint32Array(streamOf(view.getUint32(60, true), Number.MAX_SAFE_INTEGER).buffer.slice(0));
  const miniOf = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(Math.ceil(size / miniSector) * miniSector);
    let s = start;
    for (let i = 0; i * miniSector < size && s < FREESECT - 3; i++, s = miniFat[s]) {
      out.set(miniStream.subarray(s * miniSector, (s + 1) * miniSector), i * miniSector);
    }
    return out.subarray(0, size);
  };

  const streams = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const off = i * 128;
    if (directory[off + 66] !== 2) continue;
    const nameLength = Math.max(0, dir.getUint16(off + 64, true) / 2 - 1);
    let name = '';
    for (let j = 0; j < nameLength; j++) name += String.fromCharCode(dir.getUint16(off + j * 2, true));
    const size = Number(dir.getBigUint64(off + 120, true));
    const start = dir.getUint32(off + 116, true);
    streams.set(name, size === 0 ? new Uint8Array(0) : size < cutoff ? miniOf(start, size) : streamOf(start, size));
  }
  return streams;
}
