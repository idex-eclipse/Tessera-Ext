/**
 * Dataset names, in motan's notation: `deviation(stepq(stepper_x),kin(stepper_x))`.
 *
 * The name is the identity of a dataset (motan keys its caches by it), so the engine uses
 * it as the id. The UI never asks a user to type it: it builds names with the helpers
 * below. Keeping motan's spelling means a saved dataset can still be pasted into real
 * motan, and the golden tests can use motan's own command lines.
 */
import { MotanError } from './types';

/** Splits a string by commas outside parentheses (readlog.param_split). */
export function paramSplit(line: string): string[] {
  const out: string[] = [];
  let level = 0;
  let prev = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (level === 0 && ch === ',') {
      out.push(line.slice(prev, i));
      prev = i + 1;
    } else if (ch === '(') {
      level++;
    } else if (level > 0 && ch === ')') {
      level--;
    }
  }
  out.push(line.slice(prev));
  return out;
}

/** `abc(def,ghi)` -> `['abc', 'def', 'ghi']` (readlog.name_split). */
export function nameSplit(name: string): string[] {
  if (!name.includes('(') || !name.endsWith(')')) throw new MotanError(`Malformed dataset name '${name}'`);
  const open = name.indexOf('(');
  return [name.slice(0, open), ...paramSplit(name.slice(open + 1, -1))];
}

/**
 * Builds `fn(arg1,arg2,...)`. A plain argument must not contain the characters that give
 * the notation its structure; a nested dataset name (which does) is passed as is.
 */
export function dataset(fn: string, ...args: Array<string | number>): string {
  return `${fn}(${args.map(String).join(',')})`;
}

/** True when `value` can be used as a plain (leaf) argument, e.g. a stepper or sensor name. */
export function isPlainArg(value: string): boolean {
  return value.length > 0 && !/[(),]/.test(value) && value === value.trim();
}

/** Throws a MotanError unless `value` is a usable plain argument. */
export function plainArg(value: string, what: string): string {
  if (!isPlainArg(value)) throw new MotanError(`${what} '${value}' cannot be used in a dataset name`);
  return value;
}
