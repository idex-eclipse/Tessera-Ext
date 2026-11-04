#!/usr/bin/env python3
"""Builds the golden fixtures of the motion-diag test suite.

What it does
------------
1. Synthesizes captures in exactly the on-disk format of Klipper's
   scripts/motan/data_logger.py (`<name>.json.gz` + `<name>.index.gz`), with the message
   shapes Klipper's webhooks emit (see klippy/extras/motion_report.py, bulk_sensor.py,
   angle.py, ldc1612.py, load_cell.py, tmc.py). The data is deterministic and physically
   plausible (a toolhead trapq, stepper queue_step blocks derived from it, sensor
   streams), but it is NOT a real printer: the goal is to exercise every decoder and
   analyzer, not to model hardware.
2. Runs the REAL motan (scripts/motan/data_export.py of a Klipper checkout) over
   each capture for a list of cases and stores its CSV output as the expected result.

The TypeScript decoders/analyzers must reproduce those CSVs
(src/__tests__/motan-golden.test.ts). The fixtures are committed, so this script only
needs to run when the cases change.

Usage
-----
    python tools/gen_fixtures.py --klipper /path/to/klipper [--python /path/to/venv/python]

The Python used to run motan needs numpy and scipy (the `sos(...)` analyzer imports them).
Never run this on a real printer's logs; it only reads the Klipper checkout.
"""
import argparse
import gzip
import json
import math
import os
import random
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', '__tests__', 'fixtures')

MCU_FREQ = 72_000_000.0
T0 = 100.0  # initial toolhead.estimated_print_time of every capture


class LogWriter:
    """Same on-disk framing as data_logger.LogWriter: gzip stream, 0x03-terminated messages."""

    def __init__(self, filename):
        self.file = open(filename, 'wb')
        self.comp = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, 31)
        self.raw_pos = self.file_pos = 0

    def add_data(self, data):
        d = self.comp.compress(data + b'\x03')
        self.file.write(d)
        self.file_pos += len(d)
        self.raw_pos += len(data) + 1

    def flush(self):
        d = self.comp.flush(zlib.Z_FULL_FLUSH)
        self.file.write(d)
        self.file_pos += len(d)
        return self.file_pos

    def close(self):
        d = self.comp.flush(zlib.Z_FINISH)
        self.file.write(d)
        self.file.close()


def dumps(obj):
    return json.dumps(obj, separators=(',', ':')).encode()


######################################################################
# Motion plan -> trapq moves
######################################################################

def plan_moves(waypoints, cruise_v, accel, start_time):
    """Straight moves between waypoints, each as accel/cruise/decel trapq phases.

    Returns trapq entries (print_time, move_t, start_v, accel, start_pos, axes_r).
    """
    out = []
    t = start_time
    for (x0, y0, z0), (x1, y1, z1) in zip(waypoints, waypoints[1:]):
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        r = (dx / length, dy / length, dz / length)
        ta = cruise_v / accel
        da = .5 * accel * ta * ta
        if 2 * da > length:  # triangular profile
            ta = math.sqrt(length / accel)
            vpeak = accel * ta
            phases = [(ta, 0., accel), (ta, vpeak, -accel)]
        else:
            tc = (length - 2 * da) / cruise_v
            phases = [(ta, 0., accel), (tc, cruise_v, 0.), (ta, cruise_v, -accel)]
        pos = (x0, y0, z0)
        for move_t, v0, a in phases:
            out.append((t, move_t, v0, a, pos, r))
            dist = (v0 + .5 * a * move_t) * move_t
            pos = (pos[0] + r[0] * dist, pos[1] + r[1] * dist, pos[2] + r[2] * dist)
            t += move_t
        t += 0.020  # small gap between moves
    return out


def toolhead_axis(moves, axis, t):
    """Toolhead axis position at print time t (clamped like trapq decoding)."""
    last = None
    for (pt, mt, v0, a, sp, r) in moves:
        if t <= pt + mt:
            if t < pt:
                return last if last is not None else sp[axis]
            d = (v0 + .5 * a * (t - pt)) * (t - pt)
            return sp[axis] + r[axis] * d
        d = (v0 + .5 * a * mt) * mt
        last = sp[axis] + r[axis] * d
    return last


######################################################################
# queue_step generation
######################################################################

def step_events(moves, stepper_coeffs, step_dist, start_mcu_pos):
    """(time, direction) of every step of a stepper whose position is a linear
    combination of the toolhead axes: pos = sum(c_i * axis_i)."""
    events = []
    mcu_pos = start_mcu_pos
    for (pt, mt, v0, a, sp, r) in moves:
        # Stepper position along the move: p(s) = p0 + k*s with s the path distance.
        p0 = sum(c * sp[i] for i, c in enumerate(stepper_coeffs))
        k = sum(c * r[i] for i, c in enumerate(stepper_coeffs))
        if abs(k) < 1e-12:
            continue
        s_total = (v0 + .5 * a * mt) * mt
        p_end = p0 + k * s_total
        # Steps happen at every crossing of (mcu_pos +/- .5) * step_dist boundaries
        direction = 1 if k > 0 else -1
        while True:
            target = (mcu_pos + (.5 if direction > 0 else -.5)) * step_dist
            if (direction > 0 and target > p_end) or (direction < 0 and target < p_end):
                break
            s = (target - p0) / k
            if s < 0:
                break
            # Solve v0*t + .5*a*t^2 = s
            if abs(a) < 1e-9:
                t = s / v0
            else:
                disc = v0 * v0 + 2 * a * s
                t = (-v0 + math.sqrt(max(disc, 0.))) / a
            events.append((pt + t, direction))
            mcu_pos += direction
    return events


def encode_blocks(events, block_time, start_mcu_pos, step_dist, rng):
    """Group step events into queue_step blocks the way DumpStepper would report them.

    Each block is a dump_stepper message. Entries are (interval, count, add): arithmetic
    runs of up to 40 steps where the step spacing is smooth, singles elsewhere; the count
    is negative for steps of negative direction. The clocks that the consumer will
    reconstruct (step_clock += interval; interval += add) are the ones reported in
    first_clock/last_clock, so a decoder sees a self-consistent block.
    """
    blocks = []
    mcu_pos = start_mcu_pos
    i = 0
    n = len(events)
    while i < n:
        t_begin = events[i][0]
        j = i
        while j < n and events[j][0] < t_begin + block_time:
            j += 1
        chunk = events[i:j]
        i = j
        clocks = [int(round(t * MCU_FREQ)) for t, _ in chunk]
        dirs = [d for _, d in chunk]
        entries = []
        cl = []  # clocks as the consumer reconstructs them
        prev = clocks[0] - (clocks[1] - clocks[0] if len(clocks) > 1 else 5000)
        k = 0
        while k < len(chunk):
            use_max = rng.choice([1, 3, 8, 16, 40])
            use = 1
            while k + use < len(chunk) and use < use_max and dirs[k + use] == dirs[k]:
                use += 1
            d0 = clocks[k] - prev
            if use > 1:
                ds = [clocks[k + q] - clocks[k + q - 1] for q in range(1, use)]
                if d0 <= 0 or any(abs(d - d0) > .5 * d0 for d in ds):
                    use = 1
            add = 0
            if use > 1:
                add = int(round((ds[-1] - d0) / (use - 1)))
            entries.append([d0, dirs[k] * use, add])
            c, iv = prev, d0
            for _ in range(use):
                c += iv
                iv += add
                cl.append(c)
            prev = c
            k += use
        blocks.append({
            'data': entries,
            'start_position': mcu_pos * step_dist,
            'start_mcu_position': mcu_pos,
            'step_distance': step_dist,
            'first_clock': cl[0],
            'first_step_time': cl[0] / MCU_FREQ,
            'last_clock': cl[-1],
            'last_step_time': cl[-1] / MCU_FREQ,
        })
        mcu_pos += sum(dirs)
    return blocks


######################################################################
# Capture assembly
######################################################################

def batches(samples, window):
    """Split [(time, ...)...] samples into message batches of `window` seconds."""
    out = []
    cur = []
    t_end = None
    for s in samples:
        if t_end is None:
            t_end = s[0] + window
        if s[0] >= t_end and cur:
            out.append(cur)
            cur = []
            t_end = s[0] + window
        cur.append(s)
    if cur:
        out.append(cur)
    return out


def build_capture(name, kinematics, seed):
    rng = random.Random(seed)
    # --- toolhead plan ---
    if kinematics == 'cartesian':
        waypoints = [(50., 50., 5.), (90., 50., 5.), (90., 80., 5.), (60., 40., 5.), (60., 40., 7.), (70., 45., 7.)]
    else:
        waypoints = [(100., 100., 5.), (130., 100., 5.), (130., 130., 5.), (110., 90., 5.), (120., 95., 5.)]
    moves = plan_moves(waypoints, cruise_v=120., accel=3000., start_time=T0 + 0.200)
    t_end = moves[-1][0] + moves[-1][1] + 0.3

    step_dist = 40. / (200 * 16)
    if kinematics == 'cartesian':
        coeffs = {'stepper_x': (1, 0, 0), 'stepper_y': (0, 1, 0), 'stepper_z': (0, 0, 1)}
    else:
        coeffs = {'stepper_x': (1, 1, 0), 'stepper_y': (1, -1, 0), 'stepper_z': (0, 0, 1)}

    start_axes = waypoints[0]
    messages = []  # (arrival_time, bytes)

    # --- config / initial status ---
    settings = {
        'printer': {'kinematics': kinematics},
        'stepper_x': {'rotation_distance': 40., 'microsteps': 16, 'full_steps_per_rotation': 200},
        'stepper_y': {'rotation_distance': 40., 'microsteps': 16, 'full_steps_per_rotation': 200},
        'stepper_z': {'rotation_distance': 8., 'microsteps': 16, 'gear_ratio': '3:1, 2:1'},
        'tmc2209 stepper_x': {'microsteps': 16},
        'tmc2209 stepper_y': {'microsteps': 16},
        'adxl345 hotend': {'cs_pin': 'PA4'},
        'angle ang_x': {'sensor_type': 'as5047d', 'stepper': 'stepper_x'},
        'angle ang_z': {'sensor_type': 'as5047d', 'stepper': 'stepper_z'},
        'probe_eddy_current eddy': {'sensor_type': 'ldc1612'},
        'load_cell lc': {'sensor_type': 'hx711'},
    }
    status0 = {
        'configfile': {'settings': settings},
        'motion_report': {'trapq': ['toolhead'], 'steppers': ['stepper_x', 'stepper_y', 'stepper_z']},
        'toolhead': {'estimated_print_time': T0, 'print_time': T0 + 0.1, 'homed_axes': 'xyz', 'max_velocity': 300.},
        'extruder': {'temperature': 200.25, 'target': 200.},
        'tmc2209 stepper_x': {'mcu_phase_offset': 3},
        'tmc2209 stepper_y': {'mcu_phase_offset': 1},
    }

    streams = []  # (stream id, [message params...]) -> logged with {'q': id, 'params': ...}

    # --- trapq ---
    trapq_msgs = []
    entries = [[m[0], m[1], m[2], m[3], list(m[4]), list(m[5])] for m in moves]
    for chunk in batches([(e[0],) + tuple(e[1:]) for e in entries], 0.40):
        trapq_msgs.append({'data': [list(c) for c in chunk]})
    streams.append(('trapq:toolhead', trapq_msgs, lambda p: p['data'][-1][0]))

    # --- stepq ---
    mcu_pos0 = {}
    for stepper, c in coeffs.items():
        p0 = sum(ci * ai for ci, ai in zip(c, start_axes))
        mcu_pos0[stepper] = int(round(p0 / step_dist))
    for stepper, c in coeffs.items():
        ev = step_events(moves, c, step_dist, mcu_pos0[stepper])
        blocks = encode_blocks(ev, 0.30, mcu_pos0[stepper], step_dist, rng)
        streams.append(('stepq:' + stepper, blocks, lambda p: p['last_step_time']))

    # --- sensors ---
    def sensor_times(rate, jitter=0.0, t_from=T0 - 0.02, t_to=t_end):
        n = int((t_to - t_from) * rate)
        return [t_from + i / rate + (rng.random() - .5) * jitter for i in range(n)]

    accel = []
    for t in sensor_times(3200., jitter=2e-5):
        a = 2500 * math.sin(2 * math.pi * 55 * t) + 900 * math.sin(2 * math.pi * 180 * t + 1) + 300 * rng.gauss(0, 1)
        b = 1800 * math.sin(2 * math.pi * 55 * t + .5) + 150 * rng.gauss(0, 1)
        c = 9810 + 700 * math.sin(2 * math.pi * 33 * t) + 100 * rng.gauss(0, 1)
        accel.append([t, a, b, c])
    streams.append(('accelerometer:hotend', [{'data': b_} for b_ in batches(accel, 0.25)], lambda p: p['data'][-1][0]))

    angle = []
    for t in sensor_times(1000.):
        ph = (t - T0) * 5200.0 + 300 * math.sin(2 * math.pi * 7 * t)
        angle.append([t, ph])
    streams.append(('angle:ang_x', [{'data': b_, 'position_offset': 1234.5 + i * 0.0}
                                    for i, b_ in enumerate(batches(angle, 0.25))], lambda p: p['data'][-1][0]))
    angle2 = [[t, (t - T0) * 800.0] for t in sensor_times(500.)]
    streams.append(('angle:ang_z', [{'data': b_} for b_ in batches(angle2, 0.25)], lambda p: p['data'][-1][0]))

    eddy = [[t, 3.0e6 + 1.5e4 * math.sin(2 * math.pi * 4 * t) + 200 * rng.gauss(0, 1),
             2.0 + .05 * math.sin(2 * math.pi * 4 * t)] for t in sensor_times(500., jitter=1e-4)]
    streams.append(('ldc1612:eddy', [{'data': b_} for b_ in batches(eddy, 0.25)], lambda p: p['data'][-1][0]))

    lc = [[t, 120. * math.sin(2 * math.pi * 3 * t) + 5 * rng.gauss(0, 1), int(-35000 + 2000 * math.sin(2 * math.pi * 3 * t)), -34000]
          for t in sensor_times(320.)]
    streams.append(('loadcell:lc', [{'data': b_} for b_ in batches(lc, 0.25)], lambda p: p['data'][-1][0]))

    sg = [[t, int(300 + 80 * math.sin(2 * math.pi * 2 * t) + rng.randint(-10, 10)), int(14 + rng.randint(-1, 1))]
          for t in sensor_times(100.)]
    streams.append(('stallguard:stepper_x', [{'data': b_} for b_ in batches(sg, 0.25)], lambda p: p['data'][-1][0]))

    for sid, msgs, tkey in streams:
        for m in msgs:
            messages.append((tkey(m) + 0.001, dumps({'q': sid, 'params': m})))

    # --- status updates ---
    t = T0 + 0.250
    k = 0
    while t < t_end + 1.0:
        upd = {'toolhead': {'estimated_print_time': t, 'print_time': t + 0.1},
               'extruder': {'temperature': 200.25 + 0.01 * k}}
        if abs(t - (T0 + 1.25)) < 1e-9:
            upd['tmc2209 stepper_x'] = {'mcu_phase_offset': 6}
        messages.append((t, dumps({'q': 'status', 'params': {'eventtime': t - 0.05, 'status': upd}})))
        if k == 5:
            # Standalone update without toolhead time: applied immediately by TrackStatus.
            messages.append((t + 0.0005, dumps({'q': 'status', 'params': {
                'eventtime': t, 'status': {'tmc2209 stepper_y': {'mcu_phase_offset': 2}}}})))
        t += 0.250
        k += 1

    messages.sort(key=lambda m: m[0])

    # --- write files ---
    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    prefix = os.path.join(OUT, name, 'log')
    logger = LogWriter(prefix + '.json.gz')
    index = LogWriter(prefix + '.index.gz')
    logger.add_data(dumps({'id': 'info', 'result': {'state': 'ready'}}))
    logger.add_data(dumps({'id': 'status', 'result': {'eventtime': T0, 'status': status0}}))
    for _, raw in messages:
        logger.add_data(raw)
    pos = logger.flush()
    subs = {sid: {'header': []} for sid, _, _ in streams}
    subs['status'] = {'eventtime': T0}
    index.add_data(dumps({'status': status0, 'subscriptions': subs, 'file_position': pos}))
    logger.close()
    index.close()
    return prefix, t_end


######################################################################
# Cases and the reference run
######################################################################

def common_cases(kinematics):
    cases = []

    def add(cid, columns, skip=0., duration=2.0, seg=0.002):
        cases.append({'id': cid, 'columns': columns, 'skip': skip, 'duration': duration, 'segmentTime': seg})

    add('trapq', ['trapq(toolhead,velocity)', 'trapq(toolhead,accel)', 'trapq(toolhead,x)', 'trapq(toolhead,y)',
                  'trapq(toolhead,z)', 'trapq(toolhead,x_velocity)', 'trapq(toolhead,y_velocity)',
                  'trapq(toolhead,z_velocity)', 'trapq(toolhead,x_accel)', 'trapq(toolhead,y_accel)'])
    add('stepq', ['stepq(stepper_x)', 'stepq(stepper_y)', 'stepq(stepper_z)', 'stepq(stepper_x,0.02)',
                  'stepq(stepper_x,0.0005)'])
    add('kin', ['kin(stepper_x)', 'kin(stepper_y)', 'kin(stepper_z)',
                'deviation(stepq(stepper_x),kin(stepper_x))', 'deviation(stepq(stepper_y),kin(stepper_y))'])
    add('kin-fine', ['deviation(stepq(stepper_x),kin(stepper_x))', 'trapq(toolhead,velocity)'],
        duration=0.4, seg=0.0001)
    add('step-phase', ['step_phase(tmc2209 stepper_x)', 'step_phase(tmc2209 stepper_x,microstep)',
                       'step_phase(tmc2209 stepper_y)'])
    add('accelerometer', ['accelerometer(hotend,x)', 'accelerometer(hotend,y)', 'accelerometer(hotend,z)'])
    add('sensors', ['angle(ang_x)', 'angle(ang_z)', 'ldc1612(eddy)', 'ldc1612(eddy,period)', 'ldc1612(eddy,z)',
                    'loadcell(lc)', 'loadcell(lc,counts)', 'stallguard(stepper_x,sg_result)'])
    # motan quirk: two stallguard datasets of one stepper in a single run share the message
    # list and pop samples from each other, so each gets every other sample. The port reads
    # them independently (correct), hence cs_actual is checked on its own.
    add('stallguard-cs', ['stallguard(stepper_x,cs_actual)'])
    add('status', ['status(toolhead.estimated_print_time)', 'status(extruder.temperature)',
                   'status(toolhead.max_velocity)', 'status(extruder.nothing)'])
    add('analyzers', ['derivative(trapq(toolhead,x))', 'derivative(derivative(trapq(toolhead,x)))',
                      'integral(trapq(toolhead,accel))',
                      'integral(accelerometer(hotend,x))',
                      'integral(accelerometer(hotend,x),trapq(toolhead,x_velocity))',
                      'integral(accelerometer(hotend,x),trapq(toolhead,x_velocity),0.05)',
                      'norm2(trapq(toolhead,x_velocity),trapq(toolhead,y_velocity))',
                      'norm2(accelerometer(hotend,x),accelerometer(hotend,y),accelerometer(hotend,z))',
                      'smooth(accelerometer(hotend,x))', 'smooth(accelerometer(hotend,y),0.03)',
                      'deviation(trapq(toolhead,x),trapq(toolhead,y))'])
    add('sos', ['sos(accelerometer(hotend,x),filt,lowpass,2,60)',
                'sos(accelerometer(hotend,x),filtfilt,lowpass,3,60)',
                'sos(accelerometer(hotend,y),filt,highpass,2,20)',
                'sos(accelerometer(hotend,y),filtfilt,highpass,4,20)',
                'sos(accelerometer(hotend,z),filt,bandpass,2,30,100)',
                'sos(accelerometer(hotend,z),filtfilt,bandpass,3,30,100)',
                'sos(accelerometer(hotend,x),filt,notch,55,10)',
                'sos(accelerometer(hotend,x),filtfilt,notch,55,5)'])
    add('sos-fine', ['sos(accelerometer(hotend,x),filtfilt,bandpass,2,150,400)',
                     'sos(accelerometer(hotend,x),filt,lowpass,5,300)',
                     'sos(accelerometer(hotend,x),filtfilt,highpass,1,100)'],
        duration=0.5, seg=0.0005)
    add('skip', ['trapq(toolhead,velocity)', 'stepq(stepper_x)', 'accelerometer(hotend,x)',
                 'deviation(stepq(stepper_x),kin(stepper_x))', 'step_phase(tmc2209 stepper_x)',
                 'loadcell(lc)', 'status(extruder.temperature)'], skip=0.55, duration=1.0)
    if kinematics == 'corexy':
        add('corexy', ['corexy(x,stepper_x,stepper_y)', 'corexy(y,stepper_x,stepper_y)',
                       'deviation(corexy(x,stepq(stepper_x),stepq(stepper_y)),trapq(toolhead,x))',
                       'deviation(corexy(y,stepq(stepper_x),stepq(stepper_y)),trapq(toolhead,y))'])
        # Replace the first two with real datasets (corexy() takes datasets, not stepper names).
        cases[-1]['columns'][0] = 'corexy(x,stepq(stepper_x),stepq(stepper_y))'
        cases[-1]['columns'][1] = 'corexy(y,stepq(stepper_x),stepq(stepper_y))'
    return cases


def run_reference(py, klipper, prefix, cases, out_dir):
    export = os.path.join(klipper, 'scripts', 'motan', 'data_export.py')
    for case in cases:
        out_csv = os.path.join(out_dir, 'expected-%s.csv' % case['id'])
        cmd = [py, export, '-c', repr(case['columns']), '-s', repr(case['skip']), '-d', repr(case['duration']),
               '--segment-time', repr(case['segmentTime']), '-o', out_csv, prefix]
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=out_dir)
        if res.returncode != 0:
            sys.stderr.write('case %s failed:\n%s\n%s\n' % (case['id'], res.stdout, res.stderr))
            sys.exit(1)
        case['csv'] = 'expected-%s.csv' % case['id']
        print('  case %-14s -> %s' % (case['id'], os.path.getsize(out_csv)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--klipper', required=True, help='path of a Klipper checkout')
    ap.add_argument('--python', default=sys.executable, help='python with numpy+scipy to run motan')
    args = ap.parse_args()
    for name, kin, seed in (('cartesian', 'cartesian', 7), ('corexy', 'corexy', 11)):
        print('capture', name)
        prefix, t_end = build_capture(name, kin, seed)
        cases = common_cases(kin)
        out_dir = os.path.dirname(prefix)
        run_reference(args.python, args.klipper, prefix, cases, out_dir)
        with open(os.path.join(out_dir, 'cases.json'), 'w') as f:
            json.dump({'capture': name, 'kinematics': kin, 'startTime': T0, 'cases': cases}, f, indent=1)


if __name__ == '__main__':
    main()
