/**
 * Small helpers that reproduce Python semantics motan relies on, so numbers and labels
 * match its output exactly.
 */

/** Python's `round(x)`: ties go to the even integer ("banker's rounding"), unlike Math.round. */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's `a % b` for b > 0: the result is never negative. */
export function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** Python's `'%.{digits}f' % x`: exact ties round to even, JS `toFixed` rounds them up. */
export function pyFixed(x: number, digits: number): string {
  const scaled = x * 10 ** digits;
  if (Number.isFinite(scaled) && Math.abs(scaled) < 2 ** 52 && Math.abs(scaled - Math.trunc(scaled)) === 0.5) {
    const even = pyRound(scaled);
    return (even / 10 ** digits).toFixed(digits);
  }
  return x.toFixed(digits);
}
