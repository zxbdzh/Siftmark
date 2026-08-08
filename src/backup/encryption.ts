export interface EncryptedBackupHeader {
  magic: 'SIFTMARK';
  version: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: 600000;
  salt: string;
  nonce: string;
}

export interface EncryptedBackupPayload {
  header: EncryptedBackupHeader;
  ciphertext: Uint8Array;
  authenticatedHeader?: Uint8Array;
}

const ITERATIONS = 600_000;

export async function encryptBackup(
  plaintext: Uint8Array,
  password: string
): Promise<EncryptedBackupPayload> {
  if (!password) throw new Error('backup-password-required');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const header: EncryptedBackupHeader = {
    magic: 'SIFTMARK',
    version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    nonce: toBase64(nonce)
  };
  const passwordBytes = new TextEncoder().encode(password);
  const plaintextCopy = Uint8Array.from(plaintext);
  try {
    const key = await deriveKey(passwordBytes, salt);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.from(nonce).buffer,
        additionalData: Uint8Array.from(serializeEncryptedHeader(header))
          .buffer,
        tagLength: 128
      },
      key,
      plaintextCopy.buffer
    );
    return { header, ciphertext: new Uint8Array(ciphertext) };
  } finally {
    passwordBytes.fill(0);
    plaintextCopy.fill(0);
    salt.fill(0);
    nonce.fill(0);
  }
}

export async function decryptBackup(
  payload: EncryptedBackupPayload,
  password: string
): Promise<Uint8Array> {
  if (!password) throw new Error('backup-password-required');
  const salt = fromBase64(payload.header.salt);
  const nonce = fromBase64(payload.header.nonce);
  const passwordBytes = new TextEncoder().encode(password);
  const ciphertextCopy = Uint8Array.from(payload.ciphertext);
  try {
    const key = await deriveKey(passwordBytes, salt);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.from(nonce).buffer,
        additionalData: Uint8Array.from(
          payload.authenticatedHeader ??
            serializeEncryptedHeader(payload.header)
        ).buffer,
        tagLength: 128
      },
      key,
      ciphertextCopy.buffer
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('encrypted-backup-authentication-failed');
  } finally {
    passwordBytes.fill(0);
    ciphertextCopy.fill(0);
    salt.fill(0);
    nonce.fill(0);
  }
}

export function serializeEncryptedHeader(
  header: EncryptedBackupHeader
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      magic: header.magic,
      version: header.version,
      cipher: header.cipher,
      kdf: header.kdf,
      iterations: header.iterations,
      salt: header.salt,
      nonce: header.nonce
    })
  );
}

async function deriveKey(
  password: Uint8Array,
  salt: Uint8Array
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(password).buffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: Uint8Array.from(salt).buffer,
      iterations: ITERATIONS
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('invalid-encrypted-backup-header');
  }
}
