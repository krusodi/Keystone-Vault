import {
  DEFAULT_SYSTEM_NAME,
  type AppItem,
  type EncryptedVaultEnvelope,
  type PublicAdminSummary,
  type PublicAppEntry,
} from '../types/vault';

const PUBLIC_APPS_KEY = 'keystone_public_apps_v1';
const PUBLIC_APPS_SOURCE_KEY = 'keystone_public_apps_source_v1';
const ENVELOPE_STORAGE_KEY = 'keystone_vault_envelope_v1';
const SYSTEM_NAME_KEY = 'keystone_system_name_v1';

export type PublicAppsSource = 'sample' | 'user' | 'cloud';

export function toPublicAppEntry(app: AppItem | PublicAppEntry): PublicAppEntry {
  return {
    id: app.id,
    name: app.name,
    logo_type: app.logo_type,
    logo_value: app.logo_value,
    target_url: app.target_url,
    category: app.category,
    sort_order: app.sort_order,
    is_favorite: app.is_favorite,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    lastUsedAt: app.lastUsedAt,
  };
}

export function loadSystemName(): string {
  try {
    const saved = localStorage.getItem(SYSTEM_NAME_KEY)?.trim();
    return saved ? saved.slice(0, 40) : DEFAULT_SYSTEM_NAME;
  } catch {
    return DEFAULT_SYSTEM_NAME;
  }
}

export function saveSystemName(name: string): string {
  const cleaned = name.trim().slice(0, 40) || DEFAULT_SYSTEM_NAME;
  try {
    localStorage.setItem(SYSTEM_NAME_KEY, cleaned);
  } catch {
    // ignore storage quota errors
  }
  return cleaned;
}

export function getPublicAppsSource(): PublicAppsSource {
  try {
    const val = localStorage.getItem(PUBLIC_APPS_SOURCE_KEY);
    if (val === 'sample' || val === 'user' || val === 'cloud') {
      return val;
    }
  } catch {
    // ignore
  }
  return 'sample';
}

export function loadPublicApps(): PublicAppEntry[] | null {
  try {
    const raw = localStorage.getItem(PUBLIC_APPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(toPublicAppEntry).sort((a, b) => a.sort_order - b.sort_order);
  } catch {
    return null;
  }
}

export function savePublicApps(
  apps: Array<AppItem | PublicAppEntry>,
  source: PublicAppsSource = 'user'
): void {
  const sanitized = apps.map(toPublicAppEntry);
  localStorage.setItem(PUBLIC_APPS_KEY, JSON.stringify(sanitized));
  try {
    localStorage.setItem(PUBLIC_APPS_SOURCE_KEY, source);
  } catch {
    // ignore storage quota errors
  }
}

export function loadStoredEnvelope(): EncryptedVaultEnvelope | null {
  try {
    const raw = localStorage.getItem(ENVELOPE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidEnvelope(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredEnvelope(envelope: EncryptedVaultEnvelope): void {
  localStorage.setItem(ENVELOPE_STORAGE_KEY, JSON.stringify(envelope));
}

export function clearStoredEnvelope(): void {
  localStorage.removeItem(ENVELOPE_STORAGE_KEY);
}

function isValidAdminKeySlot(slot: unknown): boolean {
  if (!slot || typeof slot !== 'object') return false;
  const s = slot as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.username === 'string' &&
    typeof s.displayName === 'string' &&
    (s.role === 'super_admin' || s.role === 'admin') &&
    typeof s.salt === 'string' &&
    typeof s.iv === 'string' &&
    typeof s.wrappedDek === 'string'
  );
}

export function isValidEnvelope(data: unknown): data is EncryptedVaultEnvelope {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  const commonValid =
    obj.kdf === 'PBKDF2-SHA256' &&
    obj.cipher === 'AES-256-GCM' &&
    typeof obj.iterations === 'number' &&
    obj.iterations >= 100000 &&
    typeof obj.iv === 'string' &&
    typeof obj.ciphertext === 'string';

  if (!commonValid) return false;

  if (obj.version === 1) {
    return typeof obj.salt === 'string';
  }

  if (obj.version === 2) {
    return (
      Array.isArray(obj.keySlots) &&
      obj.keySlots.length > 0 &&
      obj.keySlots.every(isValidAdminKeySlot)
    );
  }

  return false;
}

export function getEnvelopeAdmins(
  envelope: EncryptedVaultEnvelope | null
): PublicAdminSummary[] {
  if (!envelope) return [];
  if (envelope.version === 1) {
    return [
      {
        id: 'legacy-admin',
        username: 'admin',
        displayName: 'ผู้ดูแลระบบหลัก',
        role: 'super_admin',
      },
    ];
  }
  return envelope.keySlots.map((slot) => ({
    id: slot.id,
    username: slot.username,
    displayName: slot.displayName,
    role: slot.role,
  }));
}

export function downloadEncryptedBackup(
  envelope: EncryptedVaultEnvelope,
  systemName?: string
): void {
  const json = JSON.stringify(envelope, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = (systemName || DEFAULT_SYSTEM_NAME)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'keystone-vault';
  a.href = url;
  a.download = `${slug}-backup-${dateStr}.vault.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
