import * as stream from 'stream';

type U64Pair = Uint32Array;

/**
 * Round constants
 * @type {readonly U64Pair[]}
 */
export const RC: readonly U64Pair[] = Object.freeze([
  [0x00000000, 0x00000001], [0x00000000, 0x00008082], [0x80000000, 0x0000808A],
  [0x80000000, 0x80008000], [0x00000000, 0x0000808B], [0x00000000, 0x80000001],
  [0x80000000, 0x80008081], [0x80000000, 0x00008009], [0x00000000, 0x0000008A],
  [0x00000000, 0x00000088], [0x00000000, 0x80008009], [0x00000000, 0x8000000A],
  [0x00000000, 0x8000808B], [0x80000000, 0x0000008B], [0x80000000, 0x00008089],
  [0x80000000, 0x00008003], [0x80000000, 0x00008002], [0x80000000, 0x00000080],
  [0x00000000, 0x0000800A], [0x80000000, 0x8000000A], [0x80000000, 0x80008081],
  [0x80000000, 0x00008080], [0x00000000, 0x80000001], [0x80000000, 0x80008008]
].map(a => new Uint32Array(a)));

/** Rotation offsets */
export const R = Object.freeze([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
]);

/**
 * pi step translation table
 *
 * for (let x = 0; x < 5; x++) {
 *   for (let y = 0; y < 5; y++) {
 *     PI_TRANSFORM.push([xytoi(x, y), xytoi(y, 2 * x + 3 * y)]);
 *   }
 * }
 * from matrix multiplication
 * |x2| = |0 1| |x1|
 * |y2|   |2 3| |y1|
 */
export const PI_TRANSFORM = Object.freeze([
  [0, 0], [1, 10], [2, 20], [3, 5], [4, 15],
  [5, 16], [6, 1], [7, 11], [8, 21], [9, 6],
  [10, 7], [11, 17], [12, 2], [13, 12], [14, 22],
  [15, 23], [16, 8], [17, 18], [18, 3], [19, 13],
  [20, 14], [21, 24], [22, 9], [23, 19], [24, 4]
]);

/**
 * Convert (x, y) position to flat array, with modulo 5
 * @param x X position
 * @param y Y position
 * @return {number}
 */
function xytoi(x: number, y: number): number {
  x = x % 5;
  y = y % 5;
  return y * 5 + x;
}

/**
 * Convert flat array position i to (x, y)
 * @param i Flat array position
 * @return {[number, number]} [x, y]
 */
function itoxy(i: number): [number, number] {
  return [i % 5, Math.floor(i / 5)];
}

// [most significant, least significant]
/** @typedef {Uint32Array} U64Pair */
/**
 * It is as it is named
 * @type {U64Pair}
 */
const SIXTY_FOUR_BIT: U64Pair = new Uint32Array([0xFFFFFFFF, 0xFFFFFFFF]);

/**
 * Unsigned 64-bit integer (as two unsigned 32-bit integers) rotate left
 * @param output Array to put output value
 * @param n Number
 * @param r How many places to rotate
 */
function u64Rotate(output: U64Pair, n: U64Pair, r: number) {
  let ia = n[0];
  let ib = n[1];

  // if over 32, shift by 32 first then shift the rest
  if (r >= 32) {
    let iaPrev = ia;
    ia = ib;
    ib = iaPrev;
    r -= 32;
  }
  let oa = ia;
  let ob = ib;
  // shift is now under 32
  // don't do anything if shift is 0
  if (r > 0) {
    let ri = 32 - r;
    oa = (ia << r) >>> 0;
    oa = (oa | (ib >>> ri)) >>> 0;
    ob = (ib << r) >>> 0;
    ob = (ob | (ia >>> ri)) >>> 0;
  }
  output[0] = oa;
  output[1] = ob;
}

/**
 * XOR two or more u64s
 * @param output Array to put output value
 * @param {...U64Pair} args Inputs
 */
function u64XorMany(output: U64Pair, ...args: U64Pair[]) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < args.length; i++) {
    a = (a ^ args[i][0]) >>> 0;
    b = (b ^ args[i][1]) >>> 0;
  }
  output[0] = a;
  output[1] = b;
}

/**
 * XOR exactly two u64s
 * @param output Array to put output value
 * @param a First input
 * @param b Second input
 */
function u64XorTwo(output: U64Pair, a: U64Pair, b: U64Pair) {
  output[0] = (a[0] ^ b[0]) >>> 0;
  output[1] = (a[1] ^ b[1]) >>> 0;
}

/**
 * XOR another value with first parameter, storing result in first parameter
 * @param output Array to put output value
 * @param p Input
 */
function u64XorInplace(output: U64Pair, p: U64Pair) {
  output[0] = (output[0] ^ p[0]) >>> 0;
  output[1] = (output[1] ^ p[1]) >>> 0;
}

/**
 * AND another value with first parameter, storing result in first parameter
 * @param output Array to put output value
 * @param p Input
 */
function u64AndInplace(output: U64Pair, p: U64Pair) {
  output[0] = (output[0] & p[0]) >>> 0;
  output[1] = (output[1] & p[1]) >>> 0;
}

/**
 * Pad a sequence of bytes and bits to block size
 * @param blockSize Pad to block size, in bits (usually r)
 * @param bytes Buffer of data
 * @param bits Trailing bits
 * @param bitLength Amount of trailing bits (must be less than 8)
 * @return {Buffer}
 */
export function pad(blockSize: number, bytes: Buffer, bits = 0, bitLength = 0): Buffer {
  let totalBitLength = bytes.length * 8 + bitLength;
  let paddingNeeded = blockSize - (totalBitLength % blockSize);
  if (paddingNeeded === 1) paddingNeeded += blockSize;
  let paddedBuf = Buffer.alloc((totalBitLength + paddingNeeded) / 8);
  bytes.copy(paddedBuf);
  if (bitLength) {
    paddedBuf[bytes.length] = bits & (2 ** bitLength - 1);
  }
  if (paddingNeeded) {
    // pad10*1 first bit
    paddedBuf[bytes.length] |= 2 ** bitLength;
    // pad10*1 last bit
    paddedBuf[paddedBuf.length - 1] |= 0x80;
  }
  return paddedBuf;
}

export class KeccakWritable extends stream.Writable {
  /** Bitrate but in bytes */
  public byterate: number;
  /** Temporary bytes storage */
  public _buffer: Buffer[] = [];
  /** Number of bytes currently in the buffer */
  public bufferLength = 0;

  /**
   * The constructor
   * @param instance Parent instance
   * @param r Keccak bitrate
   * @param trailingBits Trailing bits to append after end
   * @param bitLength Number of trailing bits
   */
  constructor(public instance: Keccak, public bitrate: number, public trailingBits = 0, public bitLength = 0) {
    super();
    this.byterate = bitrate / 8;
  }

  /**
   * stream.Writable _write function
   * @param chunk
   * @param _encoding Unused
   * @param callback
   */
  _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
    let bufferedLength = chunk.length + this.bufferLength;
    if (bufferedLength < this.byterate) {
      this.bufferLength += chunk.length;
      this._buffer.push(chunk);
    } else {
      let writeBuf: Buffer;
      if (bufferedLength === this.byterate) {
        writeBuf = Buffer.concat([...this._buffer, chunk]);
        this._buffer = [];
        this.bufferLength = 0;
      } else {
        // write remaining bytes back to buffer
        let excess = bufferedLength % this.byterate;
        writeBuf = Buffer.concat([...this._buffer, chunk.slice(0, chunk.length - excess)]);
        this._buffer = [chunk.slice(chunk.length - excess)];
        this.bufferLength = excess;
      }
      this.instance.absorbRaw(this.bitrate, writeBuf);
    }
    callback(null);
  }

  /**
   * stream.Writable _final function
   * @param callback
   */
  _final(callback: (error?: Error | null) => void) {
    // we can directly use Keccak.absorb on the remaining bytes
    this.instance.absorb(this.bitrate, Buffer.concat(this._buffer), this.trailingBits, this.bitLength);
    callback(null);
  }
}

// TODO: allow it to run on state lengths other than 1600
export class Keccak {
  /** Backing buffer for state and temporary values */
  public _buffer = new ArrayBuffer(480);
  /** Individual Uint32Array views of state */
  public state: U64Pair[] = new Array(25).fill(null).map((_a, i) => new Uint32Array(this._buffer, i * 8, 2));

  // temporary state arrays
  public b: U64Pair[] = new Array(25).fill(null).map((_a, i) => new Uint32Array(this._buffer, (i + 25) * 8, 2));
  public c: U64Pair[] = new Array(5).fill(null).map((_a, i) => new Uint32Array(this._buffer, (i + 50) * 8, 2));
  public d: U64Pair[] = new Array(5).fill(null).map((_a, i) => new Uint32Array(this._buffer, (i + 55) * 8, 2));

  /**
   * The constructor
   * @param rounds Number of rounds if not using default 24-round keccak
   */
  constructor(public rounds = 24) {}

  /**
   * The keccak-f[1600] function
   * @param rounds Number of rounds to perform
   *   (SHA-3 uses 24, KangarooTwelve uses 12)
   */
  keccakf(rounds = this.rounds) {
    // keccak-p reduced round uses last n round constants
    let offset = RC.length - rounds;
    for (let i = 0; i < rounds; i++) this.keccakRound(RC[offset + i]);
  }

  /**
   * Keccak round function without loop unrolling
   * @param rc Current round constant
   */
  keccakRoundOriginal(rc: U64Pair) {
    let a = this.state;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    // θ step
    for (let x = 0; x < 5; x++) {
      u64XorMany(c[x], a[xytoi(x, 0)], a[xytoi(x, 1)], a[xytoi(x, 2)], a[xytoi(x, 3)], a[xytoi(x, 4)]);
    }
    for (let x = 0; x < 5; x++) {
      u64Rotate(d[x], c[(x + 1) % 5], 1);
      u64XorInplace(d[x], c[(x + 4) % 5]);
    }
    for (let i = 0; i < 25; i++) {
      u64XorInplace(a[i], d[i % 5]);
    }

    // ρ and π steps
    for (let i = 0; i < PI_TRANSFORM.length; i++) {
      let from = PI_TRANSFORM[i][0];
      let to = PI_TRANSFORM[i][1];
      u64Rotate(b[to], a[from], R[from]);
    }

    // χ step
    for (let i = 0; i < 25; i++) {
      let [x, y] = itoxy(i);
      u64XorTwo(a[i], b[xytoi(x + 1, y)], SIXTY_FOUR_BIT);
      u64AndInplace(a[i], b[xytoi(x + 2, y)]);
      u64XorInplace(a[i], b[i]);
    }

    // ι step
    u64XorInplace(a[0], rc);
  }

  /**
   * Keccak round function but way longer than it ought to be
   * @param rc Current round constant
   */
  keccakRound(rc: U64Pair) {
    let a = this.state;
    let b = this.b;
    let c = this.c;
    let d = this.d;

    // θ step
    // unrolling provides performance gain
    u64XorMany(c[0], a[0], a[5], a[10], a[15], a[20]);
    u64XorMany(c[1], a[1], a[6], a[11], a[16], a[21]);
    u64XorMany(c[2], a[2], a[7], a[12], a[17], a[22]);
    u64XorMany(c[3], a[3], a[8], a[13], a[18], a[23]);
    u64XorMany(c[4], a[4], a[9], a[14], a[19], a[24]);

    for (let x = 0; x < 5; x++) {
      u64Rotate(d[x], c[(x + 1) % 5], 1);
      u64XorInplace(d[x], c[(x + 4) % 5]);
    }

    for (let i = 0; i < 25; i++) {
      u64XorInplace(a[i], d[i % 5]);
    }

    // ρ and π steps
    // unrolling provides performance gain
    u64Rotate(b[0], a[0], 0);
    u64Rotate(b[10], a[1], 1);
    u64Rotate(b[20], a[2], 62);
    u64Rotate(b[5], a[3], 28);
    u64Rotate(b[15], a[4], 27);
    u64Rotate(b[16], a[5], 36);
    u64Rotate(b[1], a[6], 44);
    u64Rotate(b[11], a[7], 6);
    u64Rotate(b[21], a[8], 55);
    u64Rotate(b[6], a[9], 20);
    u64Rotate(b[7], a[10], 3);
    u64Rotate(b[17], a[11], 10);
    u64Rotate(b[2], a[12], 43);
    u64Rotate(b[12], a[13], 25);
    u64Rotate(b[22], a[14], 39);
    u64Rotate(b[23], a[15], 41);
    u64Rotate(b[8], a[16], 45);
    u64Rotate(b[18], a[17], 15);
    u64Rotate(b[3], a[18], 21);
    u64Rotate(b[13], a[19], 8);
    u64Rotate(b[14], a[20], 18);
    u64Rotate(b[24], a[21], 2);
    u64Rotate(b[9], a[22], 61);
    u64Rotate(b[19], a[23], 56);
    u64Rotate(b[4], a[24], 14);

    // χ step
    for (let i = 0; i < 25; i++) {
      let x = i % 5;
      let y = Math.floor(i / 5);
      u64XorTwo(a[i], b[y * 5 + ((x + 1) % 5)], SIXTY_FOUR_BIT);
      u64AndInplace(a[i], b[y * 5 + ((x + 2) % 5)]);
      u64XorInplace(a[i], b[i]);
    }

    // ι step
    u64XorInplace(a[0], rc);
  }

  /**
   * Feed bytes to the sponge function ("absorbing" phase)
   * @param r Keccak r value ("bitrate")
   * @param bytes Buffer of data
   * @param bits Trailing bits
   * @param bitLength Amount of trailing bits (must be less than 8)
   */
  absorb(r: number, bytes: Buffer, bits = 0, bitLength = 0) {
    let padded = pad(r, bytes, bits, bitLength);
    this.absorbRaw(r, padded);
  }

  /**
   * Feed bytes to the sponge function without padding
   * Input buffer length must be a multiple of r / 8
   * @param r Keccak r value ("bitrate")
   * @param bytes Buffer of data
   */
  absorbRaw(r: number, bytes: Buffer) {
    for (let i = 0; i < bytes.length; i += r / 8) {
      for (let j = 0; j < r / 64; j++) {
        let offset = i + j * 8;
        // screwy byte order
        this.state[j][0] ^= bytes.readUInt32LE(offset + 4);
        this.state[j][1] ^= bytes.readUInt32LE(offset);
      }
      this.keccakf();
    }
  }

  /**
   * Create a stream for absorbing bytes
   * @param r Keccak r value ("bitrate")
   * @param trailingBits Trailing bits
   * @param bitLength Number of trailing bits
   * @return {KeccakWritable}
   */
  absorbStream(r: number, trailingBits = 0, bitLength = 0): KeccakWritable {
    return new KeccakWritable(this, r, trailingBits, bitLength);
  }

  /**
   * Obtain bytes from sponge function ("squeezing" phase)
   * @param r Keccak r value ("bitrate")
   * @param byteLength How many bytes to obtain
   * @return Output buffer
   */
  squeeze(r: number, byteLength: number): Buffer {
    let buf = Buffer.alloc(Math.ceil(byteLength / (r / 8)) * (r / 8));
    for (let i = 0; i < byteLength; i += r / 8) {
      for (let j = 0; j < r / 64; j++) {
        buf.writeUInt32LE(this.state[j][0], i + j * 8 + 4);
        buf.writeUInt32LE(this.state[j][1], i + j * 8);
      }
      this.keccakf();
    }
    return buf.slice(0, byteLength);
  }

  /** Clear internal state */
  clear() {
    new Uint32Array(this._buffer).fill(0);
  }
}
