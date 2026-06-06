// Generates build/icon.png — a 256x256 pixel-art cat — with no dependencies.
// Uses a tiny hand-rolled PNG encoder (zlib is built into Node).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ART = [
  '....OO....OO....',
  '...OBBO..OBBO...',
  '...OBBBOOBBBO...',
  '..OBBBBBBBBBBO..',
  '..OBBBBBBBBBBO..',
  '.OBBBBBBBBBBBBO.',
  '.OBBEEBBBBEEBBO.',
  '.OBBEEBBBBEEBBO.',
  '.OBBBBBNNBBBBBO.',
  '.OBBBBBNNBBBBBO.',
  '.OBBBBBBBBBBBBO.',
  '..OBBBBBBBBBBO..',
  '..OBBBBBBBBBBO..',
  '...OBBBBBBBBO...',
  '....OOBBBBOO....',
  '......OOOO......'
];

const PALETTE = {
  '.': [0, 0, 0, 0],
  'O': [58, 42, 26, 255],
  'B': [245, 184, 96, 255],
  'E': [111, 207, 87, 255],
  'N': [231, 131, 127, 255]
};

const GRID = 16;
const CELL = 16;            // 16 * 16 = 256
const SIZE = GRID * CELL;

function buildPixels() {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const gx = Math.floor(x / CELL);
      const gy = Math.floor(y / CELL);
      const ch = ART[gy][gx];
      const [r, g, b, a] = PALETTE[ch] || PALETTE['.'];
      const i = (y * SIZE + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return data;
}

// ---- minimal PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(SIZE, SIZE, buildPixels()));
console.log('Wrote', out);
