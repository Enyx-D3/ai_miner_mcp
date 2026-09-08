import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

// Fixed ZIP timestamp: 1980-01-01 00:00:00 (DOS epoch), so identical content => identical bytes.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

export function createDeterministicZip(entries, outputPath) {
  const names = Object.keys(entries).sort();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const name of names) {
    const safe = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (safe.includes('../')) throw new Error(`Unsafe ZIP path: ${name}`);
    const nameBuf = Buffer.from(safe, 'utf8');
    const input = Buffer.isBuffer(entries[name]) ? entries[name] : Buffer.from(String(entries[name]), 'utf8');
    const compressed = zlib.deflateRawSync(input, { level: 9 });
    const crc = crc32(input);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(compressed.length), u32(input.length), u16(nameBuf.length), u16(0), nameBuf, compressed
    ]);
    localParts.push(local);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(compressed.length), u32(input.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(names.length), u16(names.length), u32(central.length), u32(offset), u16(0)
  ]);
  const zip = Buffer.concat([...localParts, central, end]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, zip);
  return zip;
}
