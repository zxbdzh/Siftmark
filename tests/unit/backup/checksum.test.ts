import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/backup/checksum';

describe('sha256Hex', () => {
  it('hashes the exact supplied bytes deterministically', async () => {
    const bytes = new TextEncoder().encode('Siftmark');
    expect(await sha256Hex(bytes)).toBe(
      '152b7cdebdf26a44c62299ea9bd007b87718b9353280f8975ced3e700f6a7bb8'
    );
    expect(await sha256Hex(new TextEncoder().encode('Siftmark\n'))).not.toBe(
      await sha256Hex(bytes)
    );
  });
});
