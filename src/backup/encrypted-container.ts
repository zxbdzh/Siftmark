import {
  decryptBackup,
  encryptBackup,
  type EncryptedBackupHeader
} from './encryption';

const MAGIC = new TextEncoder().encode('SIFTMARK');
const PREFIX_BYTES = MAGIC.byteLength + 4;
const MAX_HEADER_BYTES = 64 * 1024;

export interface InspectedEncryptedContainer {
  header: EncryptedBackupHeader;
  ciphertext: Uint8Array;
  authenticatedHeader: Uint8Array;
}

export async function createEncryptedContainer(
  plaintext: Uint8Array,
  password: string
): Promise<Uint8Array> {
  const payload = await encryptBackup(plaintext, password);
  const headerBytes = new TextEncoder().encode(JSON.stringify(payload.header));
  const result = new Uint8Array(
    PREFIX_BYTES + headerBytes.byteLength + payload.ciphertext.byteLength
  );
  result.set(MAGIC, 0);
  new DataView(result.buffer).setUint32(
    MAGIC.byteLength,
    headerBytes.byteLength,
    false
  );
  result.set(headerBytes, PREFIX_BYTES);
  result.set(payload.ciphertext, PREFIX_BYTES + headerBytes.byteLength);
  payload.ciphertext.fill(0);
  return result;
}

export function inspectEncryptedContainer(
  bytes: Uint8Array
): InspectedEncryptedContainer {
  if (bytes.byteLength < PREFIX_BYTES + 16)
    throw new Error('invalid-encrypted-backup');
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index])
      throw new Error('invalid-encrypted-backup-magic');
  }
  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(MAGIC.byteLength, false);
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error('invalid-encrypted-backup-header');
  }
  const ciphertextOffset = PREFIX_BYTES + headerLength;
  if (ciphertextOffset + 16 > bytes.byteLength)
    throw new Error('invalid-encrypted-backup');

  const authenticatedHeader = bytes.slice(PREFIX_BYTES, ciphertextOffset);
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(authenticatedHeader)
    );
  } catch {
    throw new Error('invalid-encrypted-backup-header');
  }
  const header = validateHeader(value);
  return {
    header,
    ciphertext: bytes.slice(ciphertextOffset),
    authenticatedHeader
  };
}

export async function decryptEncryptedContainer(
  bytes: Uint8Array,
  password: string
): Promise<Uint8Array> {
  return decryptBackup(inspectEncryptedContainer(bytes), password);
}

function validateHeader(value: unknown): EncryptedBackupHeader {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid-encrypted-backup-header');
  }
  const header = value as Record<string, unknown>;
  if (
    header.magic !== 'SIFTMARK' ||
    header.version !== 1 ||
    header.cipher !== 'AES-256-GCM' ||
    header.kdf !== 'PBKDF2-SHA-256' ||
    header.iterations !== 600_000 ||
    typeof header.salt !== 'string' ||
    typeof header.nonce !== 'string'
  ) {
    throw new Error('unsupported-encrypted-backup');
  }
  if (
    decodeBase64Length(header.salt) !== 16 ||
    decodeBase64Length(header.nonce) !== 12
  ) {
    throw new Error('invalid-encrypted-backup-header');
  }
  return header as unknown as EncryptedBackupHeader;
}

function decodeBase64Length(value: string): number {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  ) {
    return -1;
  }
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
}
