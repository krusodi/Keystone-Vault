export type LogoType = 'upload' | 'url' | 'favicon' | 'preset_icon';

export type PresetIconKey =
  | 'globe'
  | 'code'
  | 'briefcase'
  | 'wallet'
  | 'message'
  | 'cloud'
  | 'shield'
  | 'terminal'
  | 'database'
  | 'palette'
  | 'mail'
  | 'folder';

export type AdminRole = 'super_admin' | 'admin';

export interface AdminKeySlot {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  salt: string; // base64 16 bytes
  iv: string; // base64 12 bytes
  wrappedDek: string; // base64 AES-256-GCM wrapped 32-byte DEK
  createdAt: number;
  updatedAt: number;
}

export interface PublicAdminSummary {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
}

export interface AppCredentials {
  username: string;
  password: string;
  notes: string;
}

export interface PublicAppEntry {
  id: string;
  name: string;
  logo_type: LogoType;
  logo_value: string;
  target_url: string;
  category: string;
  sort_order: number;
  is_favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface AppItem extends PublicAppEntry {
  credentials: AppCredentials;
}

export interface VaultSettings {
  systemName?: string;
  autoLockMinutes: number; // 0 = manual only
  clipboardClearSeconds: number; // e.g., 15, 20, 30
  theme: 'light' | 'dark';
  viewMode: 'grid' | 'table';
}

export interface DecryptedVaultPayload {
  schemaVersion: 1;
  sentinel: string;
  apps: AppItem[];
  customCategories: string[];
  settings: VaultSettings;
}

export interface EncryptedVaultEnvelopeV1 {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  updatedAt: number;
}

export interface EncryptedVaultEnvelopeV2 {
  version: 2;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  iv: string; // base64 12 bytes for payload ciphertext
  ciphertext: string; // base64 AES-256-GCM encrypted DecryptedVaultPayload with DEK
  keySlots: AdminKeySlot[];
  updatedAt: number;
}

export type EncryptedVaultEnvelope = EncryptedVaultEnvelopeV1 | EncryptedVaultEnvelopeV2;

export const DEFAULT_SYSTEM_NAME = 'Keystone Vault';

export const DEFAULT_CATEGORIES = [
  'งาน',
  'การเงิน',
  'โซเชียล',
  'พัฒนาซอฟต์แวร์',
  'ส่วนตัว',
] as const;

export const DEFAULT_SETTINGS: VaultSettings = {
  systemName: DEFAULT_SYSTEM_NAME,
  autoLockMinutes: 5,
  clipboardClearSeconds: 20,
  theme: 'light',
  viewMode: 'grid',
};

export type DevicePlatform = 'desktop' | 'tablet' | 'mobile' | 'unknown';

export interface SyncedDeviceInfo {
  id: string;
  deviceName: string;
  platform: DevicePlatform;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceInviteInfo {
  id: string;
  workspaceId: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMemberInfo {
  uid: string;
  role: 'owner' | 'member';
  label: string;
  updatedAt: number;
}

