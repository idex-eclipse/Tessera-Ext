#!/usr/bin/env python3
"""Golden data for src/core/dsp.ts: scipy's own design and filtering results.

Usage: python tools/gen_dsp_fixtures.py   (needs numpy and scipy)
"""
import json
import os
import random

import numpy as np
from scipy.signal import butter, iirnotch, tf2sos, sosfilt, sosfilt_zi, sosfiltfilt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', '__tests__', 'fixtures', 'dsp.json')

rng = random.Random(3)
x = [100 * np.sin(2 * np.pi * 0.01 * i) + 30 * np.sin(2 * np.pi * 0.21 * i) + 10 * rng.gauss(0, 1) + 50 for i in range(240)]
xa = np.array(x)

designs = []
for fs in (500., 2000.):
    for order in (1, 2, 3, 4, 5):
        designs.append(('lowpass', order, 60. if fs == 500. else 300., fs))
        designs.append(('highpass', order, 20. if fs == 500. else 100., fs))
    for order in (1, 2, 3):
        designs.append(('bandpass', order, (30., 100.) if fs == 500. else (150., 400.), fs))

cases = []
for btype, order, cutoff, fs in designs:
    sos = butter(order, cutoff, btype, output='sos', fs=fs)
    zi = sosfilt_zi(sos) * xa[0]
    filt, _ = sosfilt(sos, xa, zi=zi)
    cases.append({'kind': 'butter', 'btype': btype, 'order': order, 'cutoff': cutoff, 'fs': fs,
                  'sos': sos.tolist(), 'filt': filt.tolist(), 'filtfilt': sosfiltfilt(sos, xa).tolist()})
for freq, q, fs in ((55., 10., 500.), (55., 5., 500.), (300., 20., 2000.), (60., 0.7, 500.)):
    b, a = iirnotch(freq, Q=q, fs=fs)
    sos = tf2sos(b, a)
    zi = sosfilt_zi(sos) * xa[0]
    filt, _ = sosfilt(sos, xa, zi=zi)
    cases.append({'kind': 'notch', 'freq': freq, 'quality': q, 'fs': fs, 'sos': sos.tolist(),
                  'filt': filt.tolist(), 'filtfilt': sosfiltfilt(sos, xa).tolist()})

with open(OUT, 'w') as f:
    json.dump({'x': x, 'cases': cases}, f)
print(len(cases), 'cases')
