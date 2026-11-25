import type {
  AdminKeySlot,
  AdminRole,
  DecryptedVaultPayload,
  EncryptedVaultEnvelope,
  EncryptedVaultEnvelopeV2,
} from '../types/vault';

export const PBKDF2_ITERATIONS = 600_000;
export const VAULT_SENTINEL = 'KEYSTONE_VAULT_VERIFIED_V1';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function generateVaultDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function deriveMasterKey(
  masterPassword: string,
  saltBytes: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(saltBytes),
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function importDekCryptoKey(dekBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(dekBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function createAdminKeySlot(params: {
  id?: string;
  username: string;
  displayName: string;
  role: AdminRole;
  password: string;
  dekBytes: Uint8Array;
  createdAt?: number;
}): Promise<AdminKeySlot> {
  const now = Date.now();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveMasterKey(params.password, saltBytes, PBKDF2_ITERATIONS);

  const wrappedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(ivBytes),
    },
    wrappingKey,
    toArrayBuffer(params.dekBytes)
  );

  return {
    id: params.id ?? crypto.randomUUID(),
    username: params.username.trim(),
    displayName: params.displayName.trim() || params.username.trim(),
    role: params.role,
    salt: toBase64(saltBytes),
    iv: toBase64(ivBytes),
    wrappedDek: toBase64(new Uint8Array(wrappedBuffer)),
    createdAt: params.createdAt ?? now,
    updatedAt: now,
  };
}

export async function unwrapAdminSlot(
  slot: AdminKeySlot,
  password: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<Uint8Array> {
  const saltBytes = fromBase64(slot.salt);
  const ivBytes = fromBase64(slot.iv);
  const wrappedBytes = fromBase64(slot.wrappedDek);
  const wrappingKey = await deriveMasterKey(password, saltBytes, iterations);

  const rawDek = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(ivBytes),
    },
    wrappingKey,
    toArrayBuffer(wrappedBytes)
  );

  const dekBytes = new Uint8Array(rawDek);
  if (dekBytes.byteLength !== 32) {
    throw new Error('กุญแจถอดรหัสไม่สมบูรณ์');
  }
  return dekBytes;
}

export async function encryptVaultWithDek(
  payload: DecryptedVaultPayload,
  dekBytes: Uint8Array,
  keySlots: AdminKeySlot[]
): Promise<EncryptedVaultEnvelopeV2> {
  if (keySlots.length === 0) {
    throw new Error('ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี');
  }

  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const dekKey = await importDekCryptoKey(dekBytes);

  const encoder = new TextEncoder();
  const encodedPayload = encoder.encode(JSON.stringify(payload));

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(ivBytes),
    },
    dekKey,
    encodedPayload
  );

  return {
    version: 2,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    iv: toBase64(ivBytes),
    ciphertext: toBase64(new Uint8Array(encryptedBuffer)),
    keySlots,
    updatedAt: Date.now(),
  };
}

export interface DecryptSessionResult {
  payload: DecryptedVaultPayload;
  dekBytes: Uint8Array;
  activeAdminId: string;
  envelope: EncryptedVaultEnvelopeV2;
  wasMigratedFromV1: boolean;
}

export async function decryptVaultWithSession(
  envelope: EncryptedVaultEnvelope,
  password: string,
  adminId?: string
): Promise<DecryptSessionResult> {
  if (
    !envelope ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.cipher !== 'AES-256-GCM'
  ) {
    throw new Error('รูปแบบไฟล์ Vault ไม่ถูกต้องหรือไม่รองรับ');
  }

  if (envelope.version === 1) {
    const saltBytes = fromBase64(envelope.salt);
    const ivBytes = fromBase64(envelope.iv);
    const cipherBytes = fromBase64(envelope.ciphertext);
    const key = await deriveMasterKey(password, saltBytes, envelope.iterations);

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(ivBytes),
        },
        key,
        toArrayBuffer(cipherBytes)
      );

      const decoder = new TextDecoder();
      const parsed = JSON.parse(decoder.decode(decryptedBuffer)) as DecryptedVaultPayload;

      if (parsed.sentinel !== VAULT_SENTINEL || !Array.isArray(parsed.apps)) {
        throw new Error('โครงสร้างข้อมูลหลังถอดรหัสไม่สมบูรณ์');
      }

      // Automatically upgrade v1 envelope to v2 multi-admin key-wrapped envelope
      const dekBytes = generateVaultDek();
      const initialSlot = await createAdminKeySlot({
        username: 'admin',
        displayName: 'ผู้ดูแลระบบหลัก',
        role: 'super_admin',
        password,
        dekBytes,
      });
      const migratedEnvelope = await encryptVaultWithDek(parsed, dekBytes, [initialSlot]);

      return {
        payload: parsed,
        dekBytes,
        activeAdminId: initialSlot.id,
        envelope: migratedEnvelope,
        wasMigratedFromV1: true,
      };
    } catch {
      throw new Error('รหัสผ่านไม่ถูกต้อง หรือข้อมูลถูกแก้ไข');
    }
  }

  if (envelope.version === 2) {
    const candidateSlots = adminId
      ? envelope.keySlots.filter((s) => s.id === adminId)
      : envelope.keySlots;

    if (candidateSlots.length === 0) {
      throw new Error('ไม่พบบัญชีผู้ดูแลระบบที่เลือก');
    }

    let matchedSlot: AdminKeySlot | null = null;
    let dekBytes: Uint8Array | null = null;

    for (const slot of candidateSlots) {
      try {
        dekBytes = await unwrapAdminSlot(slot, password, envelope.iterations);
        matchedSlot = slot;
        break;
      } catch {
        // try next matching slot
      }
    }

    if (!matchedSlot || !dekBytes) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่าน Admin ไม่ถูกต้อง');
    }

    try {
      const dekKey = await importDekCryptoKey(dekBytes);
      const ivBytes = fromBase64(envelope.iv);
      const cipherBytes = fromBase64(envelope.ciphertext);
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(ivBytes),
        },
        dekKey,
        toArrayBuffer(cipherBytes)
      );

      const decoder = new TextDecoder();
      const parsed = JSON.parse(decoder.decode(decryptedBuffer)) as DecryptedVaultPayload;

      if (parsed.sentinel !== VAULT_SENTINEL || !Array.isArray(parsed.apps)) {
        throw new Error('โครงสร้างข้อมูลหลังถอดรหัสไม่สมบูรณ์');
      }

      return {
        payload: parsed,
        dekBytes,
        activeAdminId: matchedSlot.id,
        envelope,
        wasMigratedFromV1: false,
      };
    } catch {
      throw new Error('ข้อมูลคลังรหัสไม่สมบูรณ์หรือถูกแก้ไข');
    }
  }

  throw new Error('เวอร์ชันไฟล์ Vault ไม่รองรับ');
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: 'weak' | 'fair' | 'good' | 'strong';
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: 'ยังไม่ได้ระบุ', tone: 'weak' };
  }

  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;

  const entropy = password.length * Math.log2(Math.max(charsetSize, 1));

  if (password.length < 8 || entropy < 36) {
    return { score: 1, label: 'อ่อน (คาดเดาง่าย)', tone: 'weak' };
  }
  if (entropy < 55) {
    return { score: 2, label: 'ปานกลาง', tone: 'fair' };
  }
  if (entropy < 75) {
    return { score: 3, label: 'แข็งแรง', tone: 'good' };
  }
  return { score: 4, label: 'แข็งแรงมาก', tone: 'strong' };
}

export function generateSecurePassword(options?: {
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  numbers?: boolean;
  symbols?: boolean;
}): string {
  const length = Math.min(Math.max(options?.length ?? 18, 8), 64);
  const useUpper = options?.uppercase ?? true;
  const useLower = options?.lowercase ?? true;
  const useNumbers = options?.numbers ?? true;
  const useSymbols = options?.symbols ?? true;

  const sets: string[] = [];
  if (useUpper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (useLower) sets.push('abcdefghijkmnopqrstuvwxyz');
  if (useNumbers) sets.push('23456789');
  if (useSymbols) sets.push('!@#$%^&*()-_=+[]{}');

  if (sets.length === 0) {
    sets.push('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  }

  const allChars = sets.join('');
  const result: string[] = [];

  const randomIndex = (max: number): number => {
    const limit = Math.floor(0xffffffff / max) * max;
    const buf = new Uint32Array(1);
    let val = 0;
    do {
      crypto.getRandomValues(buf);
      val = buf[0];
    } while (val >= limit);
    return val % max;
  };

  for (const set of sets) {
    if (result.length < length) {
      result.push(set[randomIndex(set.length)]);
    }
  }

  while (result.length < length) {
    result.push(allChars[randomIndex(allChars.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }

  return result.join('');
}
