/**
 * Compatibility with motan: every case of the fixtures was run through Klipper's real
 * data_export.py (tools/gen_fixtures.py); the browser port must give the same table.
 */
import { readdirSync } from 'node:fs';

import { describeGolden } from './helpers/golden';

const root = new URL('./fixtures/', import.meta.url);
for (const d of readdirSync(root, { withFileTypes: true })) {
  if (d.isDirectory()) describeGolden(`motan golden: ${d.name}`, new URL(`${d.name}/`, root));
}
