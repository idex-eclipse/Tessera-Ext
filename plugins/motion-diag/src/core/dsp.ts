/**
 * The slice of scipy.signal that motan's `sos(...)` analyzer uses, ported so the browser
 * reproduces motan's numbers: Butterworth and notch design as second-order sections,
 * `sosfilt`, `sosfilt_zi` and the zero-phase `sosfiltfilt`.
 *
 * The code follows scipy's own algorithms (zpk -> sos with 'nearest' pairing, the
 * odd-extension padding of sosfiltfilt, ...) rather than a textbook design, because the
 * section order, the section count and the number of trailing zero coefficients all show
 * up in the result: sosfiltfilt derives its padding length from them. The tests compare
 * against scipy output.
 */

interface Complex {
  re: number;
  im: number;
}

const c = (re: number, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
const mul = (a: Complex, b: Complex): Complex => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Complex, s: number): Complex => c(a.re * s, a.im * s);
const conj = (a: Complex): Complex => c(a.re, -a.im);
const cabs = (a: Complex): number => Math.hypot(a.re, a.im);

function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

/** Principal square root, as numpy's complex sqrt. */
function csqrt(a: Complex): Complex {
  const r = cabs(a);
  if (r === 0) return c(0, 0);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt((r - a.re) / 2);
  return c(re, a.im < 0 || Object.is(a.im, -0) ? -im : im);
}

const isReal = (a: Complex): boolean => a.im === 0;

/** Second-order section: [b0, b1, b2, a0, a1, a2] with a0 = 1. */
export type Sos = number[][];

const EPS = 2.220446049250313e-16;

/**
 * scipy's `_cplxreal`: splits roots into one element of every complex-conjugate pair
 * (positive imaginary part) and the real roots, both sorted.
 */
function cplxreal(zIn: Complex[]): { zc: Complex[]; zr: Complex[] } {
  if (zIn.length === 0) return { zc: [], zr: [] };
  const tol = 100 * EPS;
  // lexsort((abs(imag), real)): by real part, ties by |imag|.
  const z = [...zIn].sort((a, b) => a.re - b.re || Math.abs(a.im) - Math.abs(b.im));
  const isRealIdx = z.map((v) => Math.abs(v.im) <= tol * cabs(v));
  const zr = z.filter((_, i) => isRealIdx[i]).map((v) => c(v.re, 0));
  if (zr.length === z.length) return { zc: [], zr };
  const rest = z.filter((_, i) => !isRealIdx[i]);
  const zp = rest.filter((v) => v.im > 0);
  const zn = rest.filter((v) => v.im < 0);
  if (zp.length !== zn.length) throw new Error('Array contains complex value with no matching conjugate.');
  // Runs of (nearly) equal real parts are ordered by |imag| in both halves.
  const sameReal = zp.slice(1).map((v, i) => v.re - zp[i]!.re <= tol * cabs(zp[i]!));
  let i = 0;
  while (i < sameReal.length) {
    if (!sameReal[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < sameReal.length && sameReal[j]) j++;
    // Elements i..j (inclusive) share their real part.
    for (const chunk of [zp, zn]) {
      const part = chunk.slice(i, j + 1).sort((a, b) => Math.abs(a.im) - Math.abs(b.im));
      chunk.splice(i, part.length, ...part);
    }
    i = j + 1;
  }
  for (let k = 0; k < zp.length; k++) {
    if (cabs(sub(zp[k]!, conj(zn[k]!))) > tol * cabs(zn[k]!)) {
      throw new Error('Array contains complex value with no matching conjugate.');
    }
  }
  const zc = zp.map((v, k) => scale(add(v, conj(zn[k]!)), 0.5));
  return { zc, zr };
}

/** scipy's `_nearest_real_complex_idx`. */
function nearestIdx(fro: Complex[], to: Complex, which: 'real' | 'complex' | 'any'): number {
  const order = fro.map((_, i) => i).sort((a, b) => cabs(sub(fro[a]!, to)) - cabs(sub(fro[b]!, to)));
  if (which === 'any') return order[0]!;
  const want = which === 'real';
  for (const idx of order) if (isReal(fro[idx]!) === want) return idx;
  throw new Error('no matching root');
}

/** numpy.poly for a list of roots, real part only (the roots come in conjugate pairs). */
function polyFromRoots(roots: Complex[]): number[] {
  let p: Complex[] = [c(1)];
  for (const r of roots) {
    const next: Complex[] = new Array(p.length + 1).fill(null).map(() => c(0));
    for (let i = 0; i < p.length; i++) {
      next[i] = add(next[i]!, p[i]!);
      next[i + 1] = sub(next[i + 1]!, mul(p[i]!, r));
    }
    p = next;
  }
  return p.map((v) => v.re);
}

/** scipy's `_single_zpksos` for up to two zeros and poles. */
function singleZpkSos(z: Complex[], p: Complex[], k: number): number[] {
  const sos = [0, 0, 0, 0, 0, 0];
  const b = polyFromRoots(z).map((v) => v * k);
  const a = polyFromRoots(p);
  for (let i = 0; i < b.length; i++) sos[3 - b.length + i] = b[i]!;
  for (let i = 0; i < a.length; i++) sos[6 - a.length + i] = a[i]!;
  return sos;
}

/** scipy's zpk2sos for a digital filter with the default 'nearest' pairing. */
function zpk2sos(zIn: Complex[], pIn: Complex[], k: number): Sos {
  let z = [...zIn];
  let p = [...pIn];
  if (z.length === 0 && p.length === 0) return [[k, 0, 0, 1, 0, 0]];
  while (z.length < p.length) z.push(c(0));
  while (p.length < z.length) p.push(c(0));
  const nSections = Math.floor((Math.max(p.length, z.length) + 1) / 2);
  if (p.length % 2 === 1) {
    p.push(c(0));
    z.push(c(0));
  }
  const zs = cplxreal(z);
  z = [...zs.zc, ...zs.zr];
  const ps = cplxreal(p);
  p = [...ps.zc, ...ps.zr];

  const idxWorst = (arr: Complex[]): number => {
    let best = 0;
    let bestVal = Infinity;
    arr.forEach((v, i) => {
      const d = Math.abs(1 - cabs(v));
      if (d < bestVal) {
        bestVal = d;
        best = i;
      }
    });
    return best;
  };
  const removeAt = (arr: Complex[], i: number): Complex[] => arr.filter((_, j) => j !== i);
  const realCount = (arr: Complex[]): number => arr.filter(isReal).length;

  const sos: Sos = Array.from({ length: nSections }, () => [0, 0, 0, 0, 0, 0]);
  for (let si = nSections - 1; si >= 0; si--) {
    const p1Idx = idxWorst(p);
    const p1 = p[p1Idx]!;
    p = removeAt(p, p1Idx);
    if (isReal(p1) && realCount(p) === 0) {
      const z1Idx = nearestIdx(z, p1, 'real');
      const z1 = z[z1Idx]!;
      z = removeAt(z, z1Idx);
      sos[si] = singleZpkSos([z1, c(0)], [p1, c(0)], 1);
    } else if (p.length + 1 === z.length && !isReal(p1) && realCount(p) === 1 && realCount(z) === 1) {
      // Rare leftover case in scipy: a complex pole, one real pole and one real zero remain.
      const z1Idx = nearestIdx(z, p1, 'complex');
      const z1 = z[z1Idx]!;
      z = removeAt(z, z1Idx);
      sos[si] = singleZpkSos([z1, conj(z1)], [p1, conj(p1)], 1);
    } else {
      let p2: Complex;
      if (isReal(p1)) {
        const realIdx = p.map((v, i) => (isReal(v) ? i : -1)).filter((i) => i >= 0);
        const sub2 = realIdx.map((i) => p[i]!);
        const p2Idx = realIdx[idxWorst(sub2)]!;
        p2 = p[p2Idx]!;
        p = removeAt(p, p2Idx);
      } else {
        p2 = conj(p1);
      }
      if (z.length > 0) {
        const z1Idx = nearestIdx(z, p1, 'any');
        const z1 = z[z1Idx]!;
        z = removeAt(z, z1Idx);
        if (!isReal(z1)) {
          sos[si] = singleZpkSos([z1, conj(z1)], [p1, p2], 1);
        } else if (z.length > 0) {
          const z2Idx = nearestIdx(z, p1, 'real');
          const z2 = z[z2Idx]!;
          z = removeAt(z, z2Idx);
          sos[si] = singleZpkSos([z1, z2], [p1, p2], 1);
        } else {
          sos[si] = singleZpkSos([z1], [p1, p2], 1);
        }
      } else {
        sos[si] = singleZpkSos([], [p1, p2], 1);
      }
    }
  }
  for (let i = 0; i < 3; i++) sos[0]![i] = sos[0]![i]! * k;
  return sos;
}

/** Analog Butterworth prototype poles (gain 1), as scipy's `buttap`. */
function buttap(order: number): Complex[] {
  const poles: Complex[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const ang = (Math.PI * m) / (2 * order);
    poles.push(c(-Math.cos(ang), -Math.sin(ang)));
  }
  return poles;
}

export type BandType = 'lowpass' | 'highpass' | 'bandpass';

/**
 * `scipy.signal.butter(order, cutoff, btype, output='sos', fs=fs)`.
 * `cutoff` is one frequency (Hz) or, for a bandpass, [low, high].
 */
export function butterSos(order: number, cutoff: number | [number, number], btype: BandType, fs: number): Sos {
  if (!Number.isInteger(order) || order < 0) throw new Error('Filter order must be a nonnegative integer');
  const wn = (Array.isArray(cutoff) ? cutoff : [cutoff]).map((f) => f / (fs / 2));
  if (wn.some((w) => w <= 0)) throw new Error('filter critical frequencies must be greater than 0');
  if (wn.length > 1 && !(wn[0]! < wn[1]!)) throw new Error('Wn[0] must be less than Wn[1]');
  if (wn.some((w) => w >= 1)) throw new Error(`Digital filter critical frequencies must be 0 < Wn < fs/2 (fs=${fs} -> fs/2=${fs / 2})`);
  let z: Complex[] = [];
  let p = buttap(order);
  let k = 1;
  const warped = wn.map((w) => 2 * 2 * Math.tan((Math.PI * w) / 2));

  if (btype === 'lowpass') {
    const wo = warped[0]!;
    const degree = p.length - z.length;
    z = z.map((v) => scale(v, wo));
    p = p.map((v) => scale(v, wo));
    k = k * wo ** degree;
  } else if (btype === 'highpass') {
    const wo = warped[0]!;
    const degree = p.length - z.length;
    const prodZ = z.reduce((acc, v) => mul(acc, scale(v, -1)), c(1));
    const prodP = p.reduce((acc, v) => mul(acc, scale(v, -1)), c(1));
    z = [...z.map((v) => div(c(wo), v)), ...Array.from({ length: degree }, () => c(0))];
    p = p.map((v) => div(c(wo), v));
    k = k * div(prodZ, prodP).re;
  } else {
    if (warped.length < 2) throw new Error('Wn must specify start and stop frequencies for bandpass or bandstop filter');
    const bw = warped[1]! - warped[0]!;
    const wo = Math.sqrt(warped[0]! * warped[1]!);
    const degree = p.length - z.length;
    const lpZ = z.map((v) => scale(v, bw / 2));
    const lpP = p.map((v) => scale(v, bw / 2));
    const spread = (roots: Complex[]): Complex[] => {
      const root = roots.map((v) => csqrt(sub(mul(v, v), c(wo * wo))));
      return [...roots.map((v, i) => add(v, root[i]!)), ...roots.map((v, i) => sub(v, root[i]!))];
    };
    z = [...spread(lpZ), ...Array.from({ length: degree }, () => c(0))];
    p = spread(lpP);
    k = k * bw ** degree;
  }

  // Bilinear transform with fs = 2 (normalized frequencies), as iirfilter does.
  const fs2 = 4;
  const degree = p.length - z.length;
  const prodZ = z.reduce((acc, v) => mul(acc, sub(c(fs2), v)), c(1));
  const prodP = p.reduce((acc, v) => mul(acc, sub(c(fs2), v)), c(1));
  const zz = [...z.map((v) => div(add(c(fs2), v), sub(c(fs2), v))), ...Array.from({ length: degree }, () => c(-1))];
  const pz = p.map((v) => div(add(c(fs2), v), sub(c(fs2), v)));
  const kz = k * div(prodZ, prodP).re;
  return zpk2sos(zz, pz, kz);
}

/** `scipy.signal.iirnotch(freq, Q, fs)` as a single section (what `tf2sos(*iirnotch(...))` yields). */
export function notchSos(freq: number, quality: number, fs: number): Sos {
  let w0 = (2 * freq) / fs;
  if (w0 > 1 || w0 < 0) throw new Error('w0 should be such that 0 < w0 < 1');
  const bw = (w0 / quality) * Math.PI;
  w0 = w0 * Math.PI;
  const beta = Math.tan(bw / 2);
  const gain = 1 / (1 + beta);
  return [[gain, gain * -2 * Math.cos(w0), gain, 1, -2 * gain * Math.cos(w0), 2 * gain - 1]];
}

/** scipy's `lfilter_zi` for one second-order section. */
function lfilterZi(sec: number[]): [number, number] {
  const b = sec.slice(0, 3);
  const a = sec.slice(3, 6);
  const a0 = a[0]!;
  const bn = a0 === 1 ? b : b.map((v) => v / a0);
  const an = a0 === 1 ? a : a.map((v) => v / a0);
  const sumA = an[0]! + an[1]! + an[2]!;
  if (sumA === 0) throw new Error('Filter not stable due to sum(a) == 0, i.e., having a pole at z = 1!');
  const yInf = (bn[0]! + bn[1]! + bn[2]!) / sumA;
  const d = bn.map((v, i) => v - yInf * an[i]!);
  // flip(cumsum(flip(d)))[1:]
  return [d[1]! + d[2]!, d[2]!];
}

/** `scipy.signal.sosfilt_zi`: steady-state initial conditions for a unit step, one pair per section. */
export function sosfiltZi(sos: Sos): [number, number][] {
  let sc = 1;
  return sos.map((sec) => {
    const zi = lfilterZi(sec);
    const out: [number, number] = [sc * zi[0], sc * zi[1]];
    sc *= (sec[0]! + sec[1]! + sec[2]!) / (sec[3]! + sec[4]! + sec[5]!);
    return out;
  });
}

/**
 * `scipy.signal.sosfilt(sos, x, zi=zi)` (direct form II transposed, a0 = 1).
 * `zi` is copied; the input array is not modified.
 */
export function sosfilt(sos: Sos, x: ArrayLike<number>, zi?: [number, number][]): Float64Array {
  const y = Float64Array.from(x);
  sos.forEach((sec, s) => {
    const [b0, b1, b2, , a1, a2] = sec as [number, number, number, number, number, number];
    let z0 = zi ? zi[s]![0] : 0;
    let z1 = zi ? zi[s]![1] : 0;
    for (let n = 0; n < y.length; n++) {
      const xn = y[n]!;
      const out = b0 * xn + z0;
      z0 = b1 * xn - a1 * out + z1;
      z1 = b2 * xn - a2 * out;
      y[n] = out;
    }
  });
  return y;
}

/** `scipy.signal.sosfiltfilt(sos, x)` with the default odd padding. */
export function sosfiltfilt(sos: Sos, x: ArrayLike<number>): Float64Array {
  const nSections = sos.length;
  let ntaps = 2 * nSections + 1;
  const zerosB = sos.filter((s) => s[2] === 0).length;
  const zerosA = sos.filter((s) => s[5] === 0).length;
  ntaps -= Math.min(zerosB, zerosA);
  const edge = ntaps * 3;
  const n = x.length;
  if (n <= edge) throw new Error(`The length of the input vector x must be greater than padlen, which is ${edge}.`);

  // Odd extension: reflect around the end points.
  const ext = new Float64Array(n + 2 * edge);
  const first = x[0]!;
  const last = x[n - 1]!;
  for (let i = 0; i < edge; i++) {
    ext[i] = 2 * first - x[edge - i]!;
    ext[edge + n + i] = 2 * last - x[n - 2 - i]!;
  }
  for (let i = 0; i < n; i++) ext[edge + i] = x[i]!;

  const zi = sosfiltZi(sos);
  const x0 = ext[0]!;
  const fwd = sosfilt(
    sos,
    ext,
    zi.map(([a, b]) => [a * x0, b * x0]),
  );
  const y0 = fwd[fwd.length - 1]!;
  fwd.reverse();
  const back = sosfilt(
    sos,
    fwd,
    zi.map(([a, b]) => [a * y0, b * y0]),
  );
  back.reverse();
  return back.slice(edge, back.length - edge);
}
