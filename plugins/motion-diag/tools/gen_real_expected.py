#!/usr/bin/env python3
"""Reference output of the REAL motan for a log you captured yourself.

Unlike gen_fixtures.py (synthetic logs, committed), this works on a real
`data_logger.py` capture. The result goes to `local/` (git-ignored: it is derived from
your printer's data) and src/__tests__/real-log.test.ts compares the browser port with
it when the folder exists.

Usage:
    python tools/gen_real_expected.py --klipper /path/to/klipper --log /path/to/dump \
        --cases tools/real-cases.json [--python /path/to/venv/python]

`--log` is the prefix of the log pair (`dump` for `dump.json.gz` + `dump.index.gz`).
"""
import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gen_fixtures import run_reference  # noqa: E402

LOCAL = os.path.join(HERE, '..', 'local')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--klipper', required=True)
    ap.add_argument('--log', required=True)
    ap.add_argument('--cases', required=True)
    ap.add_argument('--python', default=sys.executable)
    args = ap.parse_args()

    out_dir = os.path.abspath(LOCAL)
    os.makedirs(out_dir, exist_ok=True)
    # motan opens "<prefix>.json.gz"; copy the pair next to the expected files.
    for ext in ('json.gz', 'index.gz'):
        shutil.copyfile('%s.%s' % (args.log, ext), os.path.join(out_dir, 'log.%s' % ext))
    with open(args.cases) as f:
        cases = json.load(f)['cases']
    run_reference(args.python, args.klipper, os.path.join(out_dir, 'log'), cases, out_dir)
    with open(os.path.join(out_dir, 'cases.json'), 'w') as f:
        json.dump({'cases': cases}, f, indent=1)


if __name__ == '__main__':
    main()
