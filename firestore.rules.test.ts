import { readFileSync } from 'node:fs';

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
    name: 'Cross-Tenant Shared Workspace Vault Read',
    operation: 'get',
    path: 'workspaces/main/vaultData/primary',
    auth: { uid: 'outsiderUser', email: 'outsider@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Update Ghost Field Injection on WorkspaceRoot',
    operation: 'update',
    path: 'workspaces/main',
    auth: { uid: 'ownerUser', email: 'krusodi.ns@gmail.com', email_verified: true },
    payload: { systemName: 'Hacked', isAdmin: true, updatedAt: 'SERVER_TIME' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Self-Assigned Owner Role on WorkspaceMember Join',
    operation: 'create',
    path: 'workspaces/main/members/userB',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    payload: {
      uid: 'userB',
      workspaceId: 'main',
      workspaceOwnerId: 'ownerUser',
      role: 'owner',
      label: 'Spoofed Owner',
      inviteToken: 'valid-token-1234',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unauthorized Join Without Valid Invite Token',
    operation: 'update',
    path: 'workspaces/main',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    payload: {
      memberUids: ['ownerUser', 'userB'],
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path Variable ID Poisoning on Workspace PublicApp',
    operation: 'create',
    path: 'workspaces/main/publicApps/invalid.id$with!chars',
    auth: { uid: 'ownerUser', email: 'krusodi.ns@gmail.com', email_verified: true },
    payload: {
      workspaceId: 'main',
      ownerId: 'ownerUser',
      memberUids: ['ownerUser'],
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
    name: 'OwnerId Spoofing on Legacy PublicApp Create',
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
    name: 'Immutable workspaceId and createdAt Tampering on Update',
    operation: 'update',
    path: 'workspaces/main/publicApps/app-1',
    auth: { uid: 'ownerUser', email: 'krusodi.ns@gmail.com', email_verified: true },
    payload: {
      workspaceId: 'other-ws',
      createdAt: 1700000000000,
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery on Workspace Device',
    operation: 'create',
    path: 'workspaces/main/devices/dev-1',
    auth: { uid: 'ownerUser', email: 'krusodi.ns@gmail.com', email_verified: true },
    payload: {
      workspaceId: 'main',
      ownerId: 'ownerUser',
      memberUids: ['ownerUser'],
      id: 'dev-1',
      deviceName: 'Desktop',
      platform: 'desktop',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Denial-of-Wallet Oversized systemName (> 40 chars)',
    operation: 'update',
    path: 'workspaces/main',
    auth: { uid: 'ownerUser', email: 'krusodi.ns@gmail.com', email_verified: true },
    payload: {
      systemName: 'X'.repeat(200),
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unbounded or Invalid keySlots Array on EncryptedVault',
    operation: 'create',
    path: 'workspaces/main/vaultData/primary',
    auth: { uid: 'ownerUser', email: 'krusodi.ns@gmail.com', email_verified: true },
    payload: {
      workspaceId: 'main',
      ownerId: 'ownerUser',
      version: 2,
      kdf: 'PBKDF2-SHA256',
      iterations: 600000,
      cipher: 'AES-256-GCM',
      iv: 'abc',
      ciphertext: 'xyz',
      keySlots: ['not-a-map'],
      clientUpdatedAt: 1700000000000,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket List Query Bypass on Shared Invites & Apps',
    operation: 'list',
    path: 'workspaces/main/invites',
    auth: { uid: 'outsiderUser', email: 'outsider@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];

export function verifyRulesSyntaxPresent(): boolean {
  const rules = readFileSync('firestore.rules', 'utf8');
  return (
    rules.includes("rules_version = '2';") &&
    rules.includes('match /{document=**}') &&
    rules.includes('match /workspaces/{workspaceId}')
  );
}
