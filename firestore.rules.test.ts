/**
 * Adversarial Firestore Security Rules Test Specification ("Dirty Dozen")
 * Verifies that all 12 invalid/malicious payloads are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unverified Email Spoof on Bootstrapped Admin Path',
    operation: 'create',
    path: 'admins/spoof-uid',
    auth: { uid: 'spoof-uid', email: 'krusodi.ns@gmail.com', email_verified: false },
    payload: { uid: 'spoof-uid', role: 'admin', createdAt: 'SERVER_TIME', updatedAt: 'SERVER_TIME' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-Tenant Vault Read',
    operation: 'get',
    path: 'users/userA/vaultData/primary',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Update Ghost Field Injection on UserWorkspace',
    operation: 'update',
    path: 'users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: { systemName: 'Hacked', isAdmin: true, updatedAt: 'SERVER_TIME' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Self-Assigned Admin Registration',
    operation: 'create',
    path: 'admins/userB',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    payload: { uid: 'userB', role: 'admin', createdAt: 'SERVER_TIME', updatedAt: 'SERVER_TIME' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Subcollection Write Without Parent Workspace',
    operation: 'create',
    path: 'users/orphanUser/publicApps/app-1',
    auth: { uid: 'orphanUser', email: 'o@example.com', email_verified: true },
    payload: {
      ownerId: 'orphanUser',
      id: 'app-1',
      name: 'GitHub',
      logo_type: 'favicon',
      logo_value: 'https://github.com',
      target_url: 'https://github.com',
      category: 'งาน',
      sort_order: 0,
      is_favorite: false,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path Variable ID Poisoning',
    operation: 'create',
    path: 'users/userA/publicApps/invalid.id$with!chars',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      ownerId: 'userA',
      id: 'invalid.id$with!chars',
      name: 'Test',
      logo_type: 'favicon',
      logo_value: '',
      target_url: 'https://example.com',
      category: 'งาน',
      sort_order: 0,
      is_favorite: false,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'OwnerId Spoofing on Create',
    operation: 'create',
    path: 'users/userA/publicApps/app-2',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      ownerId: 'userB',
      id: 'app-2',
      name: 'Spoofed',
      logo_type: 'favicon',
      logo_value: '',
      target_url: 'https://example.com',
      category: 'งาน',
      sort_order: 0,
      is_favorite: false,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable createdAt Tampering on Update',
    operation: 'update',
    path: 'users/userA/publicApps/app-1',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      name: 'Renamed',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery (Non-request.time)',
    operation: 'create',
    path: 'users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      uid: 'userA',
      systemName: 'My Vault',
      createdAt: '2021-05-01T00:00:00Z',
      updatedAt: '2021-05-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Oversized systemName Payload (>40 chars)',
    operation: 'update',
    path: 'users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      systemName: 'A'.repeat(120),
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Empty or Malformed keySlots Array in EncryptedVault',
    operation: 'create',
    path: 'users/userA/vaultData/primary',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      ownerId: 'userA',
      version: 2,
      kdf: 'PBKDF2-SHA256',
      iterations: 600000,
      cipher: 'AES-256-GCM',
      iv: 'abc',
      ciphertext: 'def',
      keySlots: [],
      clientUpdatedAt: 1700000000000,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket List Query on Users Root Collection',
    operation: 'list',
    path: 'users',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];
