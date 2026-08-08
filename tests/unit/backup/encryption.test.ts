import { describe, expect, it } from 'vitest';
import {
  createEncryptedContainer,
  decryptEncryptedContainer,
  inspectEncryptedContainer
} from '../../../src/backup/encrypted-container';

describe('encrypted backup container', () => {
  it('round trips bytes with a Unicode password and randomizes every export', async () => {
    const plaintext = new TextEncoder().encode('完整配置：模型与书签');
    const first = await createEncryptedContainer(plaintext, '密碼 passphrase');
    const second = await createEncryptedContainer(plaintext, '密碼 passphrase');

    const firstHeader = inspectEncryptedContainer(first).header;
    const secondHeader = inspectEncryptedContainer(second).header;
    expect(firstHeader).toMatchObject({
      magic: 'SIFTMARK',
      version: 1,
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA-256',
      iterations: 600_000
    });
    expect(firstHeader.salt).not.toBe(secondHeader.salt);
    expect(firstHeader.nonce).not.toBe(secondHeader.nonce);
    expect(
      Array.from(await decryptEncryptedContainer(first, '密碼 passphrase'))
    ).toEqual(Array.from(plaintext));
  });

  it('rejects cryptographic headers with invalid salt or nonce sizes', async () => {
    const valid = await createEncryptedContainer(
      new Uint8Array([1]),
      'password'
    );
    const inspected = inspectEncryptedContainer(valid);
    const malformed = buildContainer(
      { ...inspected.header, salt: 'AA==' },
      inspected.ciphertext
    );

    expect(() => inspectEncryptedContainer(malformed)).toThrow(
      'invalid-encrypted-backup-header'
    );
  });

  it('fails closed for a wrong password or any authenticated-byte tampering', async () => {
    const encrypted = await createEncryptedContainer(
      new TextEncoder().encode('never return partial plaintext'),
      'correct password'
    );

    await expect(
      decryptEncryptedContainer(encrypted, 'wrong password')
    ).rejects.toThrow('encrypted-backup-authentication-failed');

    const ciphertextTampered = encrypted.slice();
    const lastIndex = ciphertextTampered.length - 1;
    ciphertextTampered[lastIndex] = (ciphertextTampered[lastIndex] ?? 0) ^ 1;
    await expect(
      decryptEncryptedContainer(ciphertextTampered, 'correct password')
    ).rejects.toThrow('encrypted-backup-authentication-failed');

    const inspected = inspectEncryptedContainer(encrypted);
    const replacement = inspected.header.salt.startsWith('A') ? 'B' : 'A';
    const headerTampered = buildContainer(
      {
        ...inspected.header,
        salt: replacement + inspected.header.salt.slice(1)
      },
      inspected.ciphertext
    );
    await expect(
      decryptEncryptedContainer(headerTampered, 'correct password')
    ).rejects.toThrow('encrypted-backup-authentication-failed');
  });
});

function buildContainer(header: object, ciphertext: Uint8Array): Uint8Array {
  const magic = new TextEncoder().encode('SIFTMARK');
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(
    magic.length + 4 + headerBytes.length + ciphertext.length
  );
  bytes.set(magic);
  new DataView(bytes.buffer).setUint32(magic.length, headerBytes.length, false);
  bytes.set(headerBytes, magic.length + 4);
  bytes.set(ciphertext, magic.length + 4 + headerBytes.length);
  return bytes;
}
