/** Unit tests of the semicircular gauge geometry (core/detection.ts). */
import { describe, expect, it } from 'vitest';

import { GAUGE, GAUGE_ZONES, gaugeArcPath, gaugePoint } from '../core/detection';

describe('gauge geometry', () => {
  it('maps the probability to the half circle: 0 left, 0.5 top, 1 right', () => {
    const left = gaugePoint(0);
    const top = gaugePoint(0.5);
    const right = gaugePoint(1);
    expect(left.x).toBeCloseTo(GAUGE.cx - GAUGE.r, 6);
    expect(left.y).toBeCloseTo(GAUGE.cy, 6);
    expect(top.x).toBeCloseTo(GAUGE.cx, 6);
    expect(top.y).toBeCloseTo(GAUGE.cy - GAUGE.r, 6);
    expect(right.x).toBeCloseTo(GAUGE.cx + GAUGE.r, 6);
    expect(right.y).toBeCloseTo(GAUGE.cy, 6);
  });

  it('clamps the probability to the arc', () => {
    expect(gaugePoint(-0.5)).toEqual(gaugePoint(0));
    expect(gaugePoint(1.5)).toEqual(gaugePoint(1));
  });

  it('every point of the arc is on the circle', () => {
    for (const p of [0.1, 0.33, 0.67, 0.9]) {
      const { x, y } = gaugePoint(p);
      expect(Math.hypot(x - GAUGE.cx, y - GAUGE.cy)).toBeCloseTo(GAUGE.r, 6);
    }
  });

  it('the zones cover the whole arc at the thresholds of level()', () => {
    expect(GAUGE_ZONES[0]).toMatchObject({ from: 0, to: 1 / 3, level: 'good' });
    expect(GAUGE_ZONES[1]).toMatchObject({ from: 1 / 3, to: 2 / 3, level: 'fishy' });
    expect(GAUGE_ZONES[2]).toMatchObject({ from: 2 / 3, to: 1, level: 'failing' });
  });

  it('the arc path goes over the top from the left point to the right point', () => {
    expect(gaugeArcPath(0, 1)).toBe(
      `M ${(GAUGE.cx - GAUGE.r).toFixed(2)} ${GAUGE.cy.toFixed(2)} A ${GAUGE.r} ${GAUGE.r} 0 0 1 ${(GAUGE.cx + GAUGE.r).toFixed(2)} ${GAUGE.cy.toFixed(2)}`,
    );
    // A segment never leaves its half of the arc.
    const seg = gaugeArcPath(0.4, 0.6);
    expect(seg.startsWith(`M ${gaugePoint(0.4).x.toFixed(2)} ${gaugePoint(0.4).y.toFixed(2)}`)).toBe(true);
    expect(seg.endsWith(`${gaugePoint(0.6).x.toFixed(2)} ${gaugePoint(0.6).y.toFixed(2)}`)).toBe(true);
  });
});
