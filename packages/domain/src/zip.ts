/**
 * A zip of files stored as they are, uncompressed, which every system opens without Praxis: what
 * the person downloads an Export as, and what a Backup is kept as (section 10.1). Names are UTF-8.
 */

const LOCAL_FILE = 0x04034b50;
const CENTRAL_FILE = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** Version 2.0, the least that reads a stored file in a folder. */
const VERSION = 20;
/** Bit 11: the names are UTF-8. */
const UTF8_NAMES = 0x0800;

/** One file in a zip: its path within it, and its bytes. */
export type ZipFile = { path: string; bytes: Uint8Array };

/** The zip holding these files in this order, each stamped with the time `at`. */
export function zip(files: ZipFile[], at: Date): Uint8Array<ArrayBuffer> {
  const { time, date } = dosTime(at);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = utf8(file.path);
    const crc = crc32(file.bytes);
    const size = file.bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_FILE, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, file.bytes);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL_FILE, true);
    central.setUint16(4, VERSION, true);
    central.setUint16(6, VERSION, true);
    central.setUint16(8, UTF8_NAMES, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    // Extra field, comment, disk, internal and external attributes are all none.
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_CENTRAL, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    whole.set(part, position);
    position += part.length;
  }
  return whole;
}

/**
 * A time as a zip keeps it: a time of day and a date, to two seconds, from 1980, with no zone.
 * Praxis gives it in UTC, the zone the Export's name counts its day in.
 */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

let table: Uint32Array | undefined;

/** The CRC-32 a zip checks each file's bytes by. */
function crc32(bytes: Uint8Array): number {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A string's UTF-8 bytes, as TextEncoder gives them, which this package cannot reach (it is
 * ECMAScript alone). A lone surrogate becomes U+FFFD, as there.
 */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  // A UTF-16 unit takes at most three bytes, and a surrogate pair, two units, takes four.
  const bytes = new Uint8Array(text.length * 3);
  let at = 0;
  for (const char of text) {
    let code = char.codePointAt(0) as number;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      bytes[at++] = code;
    } else if (code < 0x800) {
      bytes[at++] = 0xc0 | (code >> 6);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      bytes[at++] = 0xe0 | (code >> 12);
      bytes[at++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else {
      bytes[at++] = 0xf0 | (code >> 18);
      bytes[at++] = 0x80 | ((code >> 12) & 0x3f);
      bytes[at++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes.slice(0, at);
}
