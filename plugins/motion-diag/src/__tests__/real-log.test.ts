/**
 * Compatibility with motan on a REAL capture. The log and the reference CSVs live in the
 * git-ignored `local/` folder (tools/gen_real_expected.py makes it): they are derived from
 * a printer's own data, so they are not committed. Without the folder the suite is skipped.
 */
import { existsSync } from 'node:fs';
import { describe, it } from 'vitest';

import { describeGolden } from './helpers/golden';

const dir = new URL('../../local/', import.meta.url);

if (existsSync(new URL('cases.json', dir))) {
  describeGolden('motan golden: real capture', dir);
} else {
  describe.skip('motan golden: real capture', () => it('needs local/ (see tools/gen_real_expected.py)', () => {}));
}
