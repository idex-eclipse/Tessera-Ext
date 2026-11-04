import type { KlippyStreamStatus, MoonrakerProxyHandle } from '../sdk';

/**
 * Opens a Klipper bulk stream, trying the parameter sets in `variants` in turn.
 *
 * Klipper versions disagree on the key that names the sensor of some streams (the
 * load cell takes `sensor` in the documentation and `load_cell` in some code), and a
 * rejected subscription is the only way to find out. The first variant is the preferred
 * one; a stream that Klipper rejects (status `unavailable`) moves on to the next one. When
 * every variant is rejected the caller sees `unavailable` once.
 *
 * Returns a function that releases every attempt.
 */
export function openStreamWithVariants(
  handle: Pick<MoonrakerProxyHandle, 'klippyStream'>,
  method: string,
  variants: ReadonlyArray<Record<string, unknown>>,
  callbacks: {
    onData: (params: unknown) => void;
    onStatus?: (status: KlippyStreamStatus) => void;
    onAck?: (result: unknown) => void;
  },
): () => void {
  const cancels: Array<() => void> = [];
  let stopped = false;
  // Only the newest attempt may report: a rejected one must not override its successor.
  let attempt = 0;

  const open = (n: number): void => {
    const mine = ++attempt;
    cancels.push(
      handle.klippyStream(
        method,
        variants[n]!,
        (data) => {
          if (!stopped && mine === attempt) callbacks.onData(data);
        },
        (state) => {
          if (stopped || mine !== attempt) return;
          if (state === 'unavailable' && n + 1 < variants.length) {
            open(n + 1);
            return;
          }
          callbacks.onStatus?.(state);
        },
        (result) => {
          if (!stopped && mine === attempt) callbacks.onAck?.(result);
        },
      ),
    );
  };
  open(0);

  return () => {
    stopped = true;
    for (const cancel of cancels) cancel();
    cancels.length = 0;
  };
}
