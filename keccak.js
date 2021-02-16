// @ts-check
/* global BigInt */
const stream = require('stream');

/** Round constants */
const RC = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An,
  0x8000000080008000n, 0x000000000000808Bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008An,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800An, 0x800000008000000An, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
]);

/** Rotation offsets */
const R = Object.freeze([
  0n, 1n, 62n, 28n, 27n,
  36n, 44n, 6n, 55n, 20n,
  3n, 10n, 43n, 25n, 39n,
  41n, 45n, 15n, 21n, 8n,
  18n, 2n, 61n, 56n, 14n
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
const PI_TRANSFORM = Object.freeze([
  [0, 0], [1, 10], [2, 20], [3, 5], [4, 15],
  [5, 16], [6, 1], [7, 11], [8, 21], [9, 6],
  [10, 7], [11, 17], [12, 2], [13, 12], [14, 22],
  [15, 23], [16, 8], [17, 18], [18, 3], [19, 13],
  [20, 14], [21, 24], [22, 9], [23, 19], [24, 4]
]);

/**
 * Convert (x, y) position to flat array, with modulo 5
 * @param {number} x X position
 * @param {number} y Y position
 * @return {number}
 */
function xytoi(x, y) {
  x = x % 5;
  y = y % 5;
  return y * 5 + x;
}

/**
 * Convert flat array position i to (x, y)
 * @param {number} i Flat array position
 * @return {[number, number]} [x, y]
 */
function itoxy(i) {
  return [i % 5, Math.floor(i / 5)];
}

/** It is as it is named */
const SIXTY_FOUR_BIT = 2n ** 64n - 1n;
/**
 * Unsigned 64-bit integer (as bigint) rotate left
 * @param {bigint} n Number
 * @param {bigint} r How many places to rotate
 * @return {bigint}
 */
function u64Rotate(n, r) {
  return (n >> (64n - r)) | BigInt.asUintN(64, n << r);
}

/**
 * The keccak-f[1600] function
 * @param {bigint[]} a The state (5x5 matrix of u64s)
 * @param {number} rounds Number of rounds to perform
 *   (SHA-3 uses 24, KangarooTwelve uses 12)
 * @return {bigint[]} Transformed state
 */
function keccakf(a, rounds = 24) {
  for (let i = 0; i < rounds; i++) a = keccakRound(a, RC[i]);
  return a;
}

// temporary arrays for keccakf rounds
/** @type {bigint[]} */
let b = new Array(25).fill(0n);
/** @type {bigint[]} */
let c = new Array(5).fill(0n);
/** @type {bigint[]} */
let d = new Array(5).fill(0n);

/**
 * Keccak round function
 * @param {bigint[]} a Current state
 * @param {bigint} rc Current round constant
 * @return {bigint[]} Next state
 */
function keccakRound(a, rc) {
  // θ step
  for (let x = 0; x < 5; x++) {
    c[x] = a[xytoi(x, 0)] ^ a[xytoi(x, 1)] ^ a[xytoi(x, 2)] ^ a[xytoi(x, 3)] ^ a[xytoi(x, 4)];
  }
  for (let x = 0; x < 5; x++) {
    d[x] = c[(x + 4) % 5] ^ u64Rotate(c[(x + 1) % 5], 1n);
  }
  for (let i = 0; i < 25; i++) {
    a[i] ^= d[i % 5];
  }

  // ρ and π steps
  for (let [from, to] of PI_TRANSFORM) {
    b[to] = u64Rotate(a[from], R[from]);
  }

  // χ step
  for (let i = 0; i < 25; i++) {
    let [x, y] = itoxy(i);
    a[i] = b[i] ^ ((b[xytoi(x + 1, y)] ^ SIXTY_FOUR_BIT) & b[xytoi(x + 2, y)]);
  }

  // ι step
  a[0] ^= rc;

  return a;
}

/**
 * Pad a sequence of bytes and bits to block size
 * @param {number} blockSize Pad to block size, in bits (usually r)
 * @param {Buffer} bytes Buffer of data
 * @param {number} bits Trailing bits
 * @param {number} bitLength Amount of trailing bits (must be less than 8)
 * @return {Buffer}
 */
function pad(blockSize, bytes, bits = 0, bitLength = 0) {
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

class KeccakWritable extends stream.Writable {
  /**
   * The constructor
   * @param {Keccak} instance Parent instance
   * @param {number} r Keccak bitrate
   * @param {number} trailingBits Trailing bits to append after end
   * @param {number} bitLength Number of trailing bits
   */
  constructor(instance, r, trailingBits = 0, bitLength = 0) {
    super();
    this.instance = instance;
    this.bitrate = r;
    this.byterate = r / 8;
    this.trailingBits = trailingBits;
    this.bitLength = bitLength;

    /**
     * Temporary bytes storage
     * @type {Buffer[]}
     */
    this._buffer = [];
    /**
     * Number of bytes currently in the buffer
     * @type {number}
     */
    this.bufferLength = 0;
  }

  /**
   * stream.Writable _write function
   * @param {Buffer} chunk
   * @param {string} _encoding Unused
   * @param {Function} callback
   */
  _write(chunk, _encoding, callback) {
    let bufferedLength = chunk.length + this.bufferLength;
    if (bufferedLength < this.byterate) {
      this.bufferLength += chunk.length;
      this._buffer.push(chunk);
    } else {
      /** @type {Buffer} */
      let writeBuf;
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
      for (let i = 0; i < writeBuf.length; i += this.byterate) {
        for (let j = 0; j < this.bitrate / 64; j++) {
          this.instance.state[j] ^= writeBuf.readBigUInt64LE(i + j * 8);
        }
        this.instance.keccakf();
      }
    }
    callback(null);
  }

  /**
   * stream.Writable _final function
   * @param {Function} callback
   */
  _final(callback) {
    // we can directly use Keccak.absorb on the remaining bytes
    this.instance.absorb(this.bitrate, Buffer.concat(this._buffer), this.trailingBits, this.bitLength);
    callback(null);
  }
}

// TODO: allow it to run on state lengths other than 1600
class Keccak {
  constructor(rounds = 24) {
    /** @type {bigint[]} */
    this.state = new Array(25).fill(0n);
    this.rounds = rounds;
  }

  /** Run keccak-f on internal state */
  keccakf() {
    keccakf(this.state, this.rounds);
  }

  /**
   * Feed bytes to the sponge function ("absorbing" phase)
   * @param {number} r Keccak r value ("bitrate")
   * @param {Buffer} bytes Buffer of data
   * @param {number} bits Trailing bits
   * @param {number} bitLength Amount of trailing bits (must be less than 8)
   */
  absorb(r, bytes, bits = 0, bitLength = 0) {
    let padded = pad(r, bytes, bits, bitLength);
    for (let i = 0; i < padded.length; i += r / 8) {
      for (let j = 0; j < r / 64; j++) {
        this.state[j] ^= padded.readBigUInt64LE(i + j * 8);
      }
      this.keccakf();
    }
  }

  /**
   * Create a stream for absorbing bytes
   * @param {number} r Keccak r value ("bitrate")
   * @param {number} trailingBits Trailing bits
   * @param {number} bitLength Number of trailing bits
   * @return {KeccakWritable}
   */
  absorbStream(r, trailingBits = 0, bitLength = 0) {
    return new KeccakWritable(this, r, trailingBits, bitLength);
  }

  /**
   * Obtain bytes from sponge function ("squeezing" phase)
   * @param {number} r Keccak r value ("bitrate")
   * @param {number} byteLength How many bytes to obtain
   * @return {Buffer}
   */
  squeeze(r, byteLength) {
    let buf = Buffer.alloc(Math.ceil(byteLength / (r / 8)) * (r / 8));
    for (let i = 0; i < byteLength; i += r / 8) {
      for (let j = 0; j < r / 64; j++) {
        buf.writeBigUInt64LE(this.state[j], i + j * 8);
      }
      this.keccakf();
    }
    return buf.slice(0, byteLength);
  }

  /** Clear internal state */
  clear() {
    this.state.fill(0n);
  }
}

module.exports = {
  keccakf,
  keccakRound,
  pad,
  Keccak,
  KeccakWritable
};
