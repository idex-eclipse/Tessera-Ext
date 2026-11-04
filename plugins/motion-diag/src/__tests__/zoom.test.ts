import { describe, expect, it } from 'vitest';

import { wheelDelta, zoomAround } from '../core/zoom';

const bounds = { min: 0, max: 60 };

describe('zoomAround', () => {
  it('zooms in when the wheel goes up and keeps the point under the cursor in place', () => {
    const view = { min: 10, max: 30 };
    const out = zoomAround(view, 25, -100, bounds, 0.01);
    expect(out.max - out.min).toBeLessThan(20);
    // the cursor was 75% of the way across; it still is
    expect((25 - out.min) / (out.max - out.min)).toBeCloseTo(0.75, 10);
  });

  it('zooms out when the wheel goes down, around the same point', () => {
    const view = { min: 20, max: 30 };
    const out = zoomAround(view, 22, 100, bounds, 0.01);
    expect(out.max - out.min).toBeGreaterThan(10);
    expect((22 - out.min) / (out.max - out.min)).toBeCloseTo(0.2, 10);
  });

  it('zooming in then out by the same amount comes back', () => {
    const view = { min: 10, max: 30 };
    const inner = zoomAround(view, 18, -150, bounds, 0.01);
    const back = zoomAround(inner, 18, 150, bounds, 0.01);
    expect(back.min).toBeCloseTo(view.min, 9);
    expect(back.max).toBeCloseTo(view.max, 9);
  });

  it('never leaves the data and slides back from an edge instead of cutting the span', () => {
    const out = zoomAround({ min: 50, max: 58 }, 57, 200, bounds, 0.01);
    expect(out.min).toBeGreaterThanOrEqual(0);
    expect(out.max).toBeLessThanOrEqual(60);
    const span = out.max - out.min;
    expect(span).toBeGreaterThan(8);
    expect(zoomAround({ min: 0, max: 4 }, 0, 200, bounds, 0.01).min).toBe(0);
  });

  it('stops at the whole data when zooming out', () => {
    let v = { min: 20, max: 30 };
    for (let i = 0; i < 40; i++) v = zoomAround(v, 25, 300, bounds, 0.01);
    expect(v).toEqual(bounds);
    expect(zoomAround(bounds, 30, 100, bounds, 0.01)).toEqual(bounds);
  });

  it('stops at the narrowest span when zooming in', () => {
    let v = { min: 20, max: 30 };
    for (let i = 0; i < 100; i++) v = zoomAround(v, 25, -300, bounds, 0.05);
    expect(v.max - v.min).toBeCloseTo(0.05, 9);
    expect(v.min).toBeLessThanOrEqual(25);
    expect(v.max).toBeGreaterThanOrEqual(25);
  });

  it('limits what one fast event can do', () => {
    const slow = zoomAround({ min: 0, max: 60 }, 30, -300, bounds, 0.01);
    const fast = zoomAround({ min: 0, max: 60 }, 30, -30_000, bounds, 0.01);
    expect(fast).toEqual(slow);
  });

  it('does not do anything for a zero movement', () => {
    expect(zoomAround({ min: 10, max: 30 }, 20, 0, bounds, 0.01)).toEqual({ min: 10, max: 30 });
  });
});

describe('wheelDelta', () => {
  it('takes the vertical movement, or the horizontal one the browser makes of Shift + wheel', () => {
    expect(wheelDelta({ deltaX: 0, deltaY: -100, deltaMode: 0 })).toBe(-100);
    expect(wheelDelta({ deltaX: -100, deltaY: 0, deltaMode: 0 })).toBe(-100);
    expect(wheelDelta({ deltaX: 3, deltaY: 120, deltaMode: 0 })).toBe(120);
  });

  it('turns lines and pages into pixels', () => {
    expect(wheelDelta({ deltaX: 0, deltaY: -3, deltaMode: 1 })).toBe(-120);
    expect(wheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toBe(800);
  });
});
