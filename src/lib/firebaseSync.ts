import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  DEFAULT_SYSTEM_NAME,
  type AdminKeySlot,
  type DevicePlatform,
  type EncryptedVaultEnvelopeV2,
  type LogoType,
  type PublicAppEntry,
  type SyncedDeviceInfo,
  type WorkspaceInviteInfo,
  type WorkspaceMemberInfo,
} from '../types/vault';
import { db, handleFirestoreError, OperationType } from './firebase';

export const DEFAULT_SHARED_WORKSPACE_ID = 'main';
const BOOTSTRAPPED_ADMIN_EMAIL = 'krusodi.ns@gmail.com';
const WORKSPACE_ID_STORAGE_KEY = 'keystone_workspace_id_v1';
const DEVICE_ID_STORAGE_KEY = 'keystone_device_id_v1';
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const VALID_LOGO_TYPES = new Set<LogoType>(['upload', 'url', 'favicon', 'preset_icon']);

function sanitizeDocId(id: string): string {
  const cleaned = id.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  return cleaned && VALID_ID_REGEX.test(cleaned) ? cleaned : crypto.randomUUID();
}

function sanitizeSystemName(name: string): string {
  const trimmed = name.trim().slice(0, 40);
  return trimmed || DEFAULT_SYSTEM_NAME;
}

export function getSavedWorkspaceId(): string {
  try {
    const saved = localStorage.getItem(WORKSPACE_ID_STORAGE_KEY);
    if (saved && VALID_ID_REGEX.test(saved) && saved.length <= 128) {
      return saved;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SHARED_WORKSPACE_ID;
}

export function saveWorkspaceId(workspaceId: string): string {
  const clean = sanitizeDocId(workspaceId);
  try {
    localStorage.setItem(WORKSPACE_ID_STORAGE_KEY, clean);
  } catch {
    // ignore
  }
  return clean;
}

export function consumeWorkspaceInviteFromUrl(): {
  workspaceId?: string;
  inviteCode?: string;
} {
  if (typeof window === 'undefined') return {};
  try {
    const url = new URL(window.location.href);
    const wsParam = url.searchParams.get('ws')?.trim();
    const inviteParam = url.searchParams.get('invite')?.trim();
    if (!wsParam && !inviteParam) return {};

    const result: { workspaceId?: string; inviteCode?: string } = {};
    if (wsParam && VALID_ID_REGEX.test(wsParam) && wsParam.length <= 128) {
      result.workspaceId = wsParam;
    }
    if (
      inviteParam &&
      VALID_ID_REGEX.test(inviteParam) &&
      inviteParam.length >= 8 &&
      inviteParam.length <= 64
    ) {
      result.inviteCode = inviteParam;
    }

    url.searchParams.delete('ws');
    url.searchParams.delete('invite');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    return result;
  } catch {
    return {};
  }
}

interface SanitizedPublicAppPayload {
  workspaceId: string;
  ownerId: string;
  memberUids: string[];
  id: string;
  name: string;
  logo_type: LogoType;
  logo_value: string;
  target_url: string;
  category: string;
  sort_order: number;
  is_favorite: boolean;
  lastUsedAt?: number;
}

function sanitizePublicAppPayload(
  workspaceId: string,
  ownerId: string,
  memberUids: string[],
  app: PublicAppEntry,
  index: number
): SanitizedPublicAppPayload {
  const cleanId = sanitizeDocId(app.id);
  const logoType: LogoType = VALID_LOGO_TYPES.has(app.logo_type)
    ? app.logo_type
    : 'preset_icon';
  const sortOrder = Math.min(Math.max(Math.trunc(app.sort_order ?? index), 0), 10000);
  const cleanMembers = Array.from(new Set(memberUids.map(sanitizeDocId))).slice(0, 20);
  if (cleanMembers.length === 0) cleanMembers.push(sanitizeDocId(ownerId));

  const base: SanitizedPublicAppPayload = {
    workspaceId: sanitizeDocId(workspaceId),
    ownerId: sanitizeDocId(ownerId),
    memberUids: cleanMembers,
    id: cleanId,
    name: (app.name.trim() || 'App').slice(0, 100),
    logo_type: logoType,
    logo_value: (app.logo_value ?? '').slice(0, 200000),
    target_url: (app.target_url.trim() || 'https://example.com').slice(0, 2048),
    category: (app.category.trim() || 'ทั่วไป').slice(0, 60),
    sort_order: sortOrder,
    is_favorite: Boolean(app.is_favorite),
  };

  if (
    typeof app.lastUsedAt === 'number' &&
    Number.isFinite(app.lastUsedAt) &&
    app.lastUsedAt >= 0
  ) {
    return { ...base, lastUsedAt: Math.trunc(app.lastUsedAt) };
  }
  return base;
}

function sanitizeKeySlots(slots: AdminKeySlot[]): AdminKeySlot[] {
  return slots.slice(0, 20).map((slot) => ({
    id: sanitizeDocId(slot.id),
    username: (slot.username.trim() || 'admin').slice(0, 64),
    displayName: (slot.displayName.trim() || slot.username.trim() || 'Admin').slice(0, 80),
    role: slot.role === 'super_admin' ? 'super_admin' : 'admin',
    salt: slot.salt.slice(0, 128),
    iv: slot.iv.slice(0, 64),
    wrappedDek: slot.wrappedDek.slice(0, 256),
    createdAt: Math.max(0, Math.trunc(slot.createdAt || Date.now())),
    updatedAt: Math.max(0, Math.trunc(slot.updatedAt || Date.now())),
  }));
}

function toEpochMs(val: unknown, fallback: number): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return fallback;
}

export function getLocalDeviceIdentity(): {
  id: string;
  deviceName: string;
  platform: DevicePlatform;
} {
  let id = '';
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && VALID_ID_REGEX.test(existing) && existing.length <= 128) {
      id = existing;
    } else {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
  } catch {
    id = crypto.randomUUID();
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isTablet =
    /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua);
  const platform: DevicePlatform = isTablet
    ? 'tablet'
    : isMobile
      ? 'mobile'
      : 'desktop';

  let osLabel = 'อุปกรณ์';
  if (/iPhone|iPad|iPod/i.test(ua)) osLabel = 'iOS';
  else if (/Android/i.test(ua)) osLabel = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) osLabel = 'macOS';
  else if (/Windows/i.test(ua)) osLabel = 'Windows';
  else if (/Linux/i.test(ua)) osLabel = 'Linux';

  let browserLabel = 'Browser';
  if (/Edg\//i.test(ua)) browserLabel = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browserLabel = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browserLabel = 'Safari';
  else if (/Firefox\//i.test(ua)) browserLabel = 'Firefox';

  const prefix =
    platform === 'mobile' ? 'Mobile' : platform === 'tablet' ? 'Tablet' : 'Desktop';
  const deviceName = `${prefix} · ${osLabel} (${browserLabel})`.slice(0, 80);

  return { id, deviceName, platform };
}

export type SharedWorkspaceResolution =
  | {
      status: 'connected';
      workspaceId: string;
      ownerId: string;
      isOwner: boolean;
      memberUids: string[];
      systemName: string;
    }
  | {
      status: 'needs_invite';
      workspaceId: string;
    };

async function migrateLegacyUserWorkspaceToShared(
  uid: string,
  workspaceId: string,
  fallbackSystemName: string
): Promise<string> {
  let resolvedName = sanitizeSystemName(fallbackSystemName);

  try {
    const legacyUserSnap = await getDoc(doc(db, 'users', uid));
    if (legacyUserSnap.exists()) {
      const legacyName = legacyUserSnap.data().systemName;
      if (typeof legacyName === 'string' && legacyName.trim()) {
        resolvedName = sanitizeSystemName(legacyName);
        await updateDoc(doc(db, 'workspaces', workspaceId), {
          systemName: resolvedName,
          updatedAt: serverTimestamp(),
        });
      }
    }

    const legacyAppsSnap = await getDocs(
      query(collection(db, 'users', uid, 'publicApps'), where('ownerId', '==', uid))
    );
    if (!legacyAppsSnap.empty) {
      const batch = writeBatch(db);
      const appIds: string[] = [];
      legacyAppsSnap.docs.forEach((d, idx) => {
        const data = d.data();
        const entry: PublicAppEntry = {
          id: String(data.id ?? d.id),
          name: String(data.name ?? 'App'),
          logo_type: VALID_LOGO_TYPES.has(data.logo_type as LogoType)
            ? (data.logo_type as LogoType)
            : 'preset_icon',
          logo_value: String(data.logo_value ?? ''),
          target_url: String(data.target_url ?? 'https://example.com'),
          category: String(data.category ?? 'ทั่วไป'),
          sort_order: Number(data.sort_order ?? idx),
          is_favorite: Boolean(data.is_favorite),
          createdAt: toEpochMs(data.createdAt, Date.now()),
          updatedAt: toEpochMs(data.updatedAt, Date.now()),
          lastUsedAt: typeof data.lastUsedAt === 'number' ? data.lastUsedAt : undefined,
        };
        const sanitized = sanitizePublicAppPayload(workspaceId, uid, [uid], entry, idx);
        appIds.push(sanitized.id);
        batch.set(doc(db, 'workspaces', workspaceId, 'publicApps', sanitized.id), {
          ...sanitized,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      batch.set(
        doc(db, 'workspaces', workspaceId, 'publicState', 'index'),
        {
          workspaceId,
          ownerId: uid,
          appIds: appIds.slice(0, 200),
          deviceIds: [],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await batch.commit();
    }

    const legacyVaultSnap = await getDoc(doc(db, 'users', uid, 'vaultData', 'primary'));
    if (legacyVaultSnap.exists()) {
      const v = legacyVaultSnap.data();
      if (
        v.version === 2 &&
        v.kdf === 'PBKDF2-SHA256' &&
        v.cipher === 'AES-256-GCM' &&
        typeof v.iv === 'string' &&
        typeof v.ciphertext === 'string' &&
        Array.isArray(v.keySlots) &&
        v.keySlots.length > 0
      ) {
        await setDoc(doc(db, 'workspaces', workspaceId, 'vaultData', 'primary'), {
          workspaceId,
          ownerId: uid,
          version: 2,
          kdf: 'PBKDF2-SHA256',
          iterations: Number(v.iterations ?? 600000),
          cipher: 'AES-256-GCM',
          iv: v.iv,
          ciphertext: v.ciphertext,
          keySlots: sanitizeKeySlots(v.keySlots as AdminKeySlot[]),
          clientUpdatedAt: Number(v.clientUpdatedAt ?? Date.now()),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch {
    // Legacy workspace might not exist or already migrated; continue cleanly
  }

  return resolvedName;
}

async function bootstrapOwnedSharedWorkspace(
  uid: string,
  workspaceId: string,
  fallbackSystemName: string
): Promise<SharedWorkspaceResolution> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanName = sanitizeSystemName(fallbackSystemName);
  const wsPath = `workspaces/${cleanWsId}`;
  const wsRef = doc(db, 'workspaces', cleanWsId);

  let existed = false;
  try {
    const existingSnap = await getDoc(wsRef);
    existed = existingSnap.exists();
  } catch {
    // Not created yet or inaccessible -> attempt creation below
    existed = false;
  }

  if (!existed) {
    try {
      await setDoc(wsRef, {
        id: cleanWsId,
        ownerId: uid,
        systemName: cleanName,
        memberUids: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, wsPath);
    }
  }

  const memberPath = `workspaces/${cleanWsId}/members/${uid}`;
  const memberRef = doc(db, 'workspaces', cleanWsId, 'members', uid);
  let memberSnap;
  try {
    memberSnap = await getDoc(memberRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, memberPath);
  }

  if (!memberSnap.exists()) {
    try {
      await setDoc(memberRef, {
        uid,
        workspaceId: cleanWsId,
        workspaceOwnerId: uid,
        role: 'owner',
        label: 'ผู้ดูแลหลัก',
        inviteToken: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, memberPath);
    }
  }

  const indexPath = `workspaces/${cleanWsId}/publicState/index`;
  const indexRef = doc(db, 'workspaces', cleanWsId, 'publicState', 'index');
  try {
    const idxSnap = await getDoc(indexRef);
    if (!idxSnap.exists()) {
      await setDoc(indexRef, {
        workspaceId: cleanWsId,
        ownerId: uid,
        appIds: [],
        deviceIds: [],
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, indexPath);
  }

  const finalName = !existed
    ? await migrateLegacyUserWorkspaceToShared(uid, cleanWsId, cleanName)
    : cleanName;

  saveWorkspaceId(cleanWsId);

  return {
    status: 'connected',
    workspaceId: cleanWsId,
    ownerId: uid,
    isOwner: true,
    memberUids: [uid],
    systemName: finalName,
  };
}

export async function resolveSharedWorkspaceAccess(
  uid: string,
  userEmail: string | null | undefined,
  preferredWorkspaceId: string,
  fallbackSystemName: string
): Promise<SharedWorkspaceResolution> {
  const cleanWsId = sanitizeDocId(preferredWorkspaceId || DEFAULT_SHARED_WORKSPACE_ID);
  const memberPath = `workspaces/${cleanWsId}/members/${uid}`;

  let memberSnap;
  try {
    memberSnap = await getDoc(doc(db, 'workspaces', cleanWsId, 'members', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, memberPath);
  }

  if (memberSnap.exists()) {
    const wsPath = `workspaces/${cleanWsId}`;
    let wsSnap;
    try {
      wsSnap = await getDoc(doc(db, 'workspaces', cleanWsId));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, wsPath);
    }

    if (wsSnap.exists()) {
      const data = wsSnap.data();
      const memberUids = Array.isArray(data.memberUids)
        ? (data.memberUids as string[]).map(String)
        : [uid];
      const ownerId = String(data.ownerId ?? uid);
      const sysName =
        typeof data.systemName === 'string' && data.systemName.trim()
          ? sanitizeSystemName(data.systemName)
          : DEFAULT_SYSTEM_NAME;
      saveWorkspaceId(cleanWsId);
      return {
        status: 'connected',
        workspaceId: cleanWsId,
        ownerId,
        isOwner: ownerId === uid,
        memberUids,
        systemName: sysName,
      };
    }
  }

  const personalWsId = `ws-${sanitizeDocId(uid.slice(0, 16))}`;
  const isBootstrappedOwner = userEmail === BOOTSTRAPPED_ADMIN_EMAIL;

  if (
    (cleanWsId === DEFAULT_SHARED_WORKSPACE_ID && isBootstrappedOwner) ||
    cleanWsId === personalWsId
  ) {
    return bootstrapOwnedSharedWorkspace(uid, cleanWsId, fallbackSystemName);
  }

  return {
    status: 'needs_invite',
    workspaceId: cleanWsId,
  };
}

export async function createPersonalSharedWorkspace(
  uid: string,
  fallbackSystemName: string
): Promise<SharedWorkspaceResolution> {
  const personalWsId = `ws-${sanitizeDocId(uid.slice(0, 16))}`;
  return bootstrapOwnedSharedWorkspace(uid, personalWsId, fallbackSystemName);
}

async function getWorkspaceMetadata(
  uid: string,
  workspaceId: string
): Promise<{ ownerId: string; memberUids: string[]; systemName: string }> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const path = `workspaces/${cleanWsId}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'workspaces', cleanWsId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  if (!snap.exists()) {
    throw new Error('ไม่พบฐานข้อมูลร่วมที่ระบุ');
  }
  const data = snap.data();
  const ownerId = String(data.ownerId ?? uid);
  const memberUids = Array.isArray(data.memberUids)
    ? (data.memberUids as string[]).map(String)
    : [ownerId];
  const systemName =
    typeof data.systemName === 'string' && data.systemName.trim()
      ? sanitizeSystemName(data.systemName)
      : DEFAULT_SYSTEM_NAME;
  return { ownerId, memberUids, systemName };
}

export async function createWorkspaceInvite(
  uid: string,
  workspaceId: string
): Promise<WorkspaceInviteInfo> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  const code = `KV-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
  const path = `workspaces/${cleanWsId}/invites/${code}`;

  try {
    await setDoc(doc(db, 'workspaces', cleanWsId, 'invites', code), {
      id: code,
      workspaceId: cleanWsId,
      ownerId: uid,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  const now = Date.now();
  return {
    id: code,
    workspaceId: cleanWsId,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listWorkspaceInvites(
  uid: string,
  workspaceId: string
): Promise<WorkspaceInviteInfo[]> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const path = `workspaces/${cleanWsId}/invites`;
  const q = query(
    collection(db, 'workspaces', cleanWsId, 'invites'),
    where('ownerId', '==', uid)
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
  const now = Date.now();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        workspaceId: cleanWsId,
        active: Boolean(data.active),
        createdAt: toEpochMs(data.createdAt, now),
        updatedAt: toEpochMs(data.updatedAt, now),
      };
    })
    .filter((i) => i.active)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeWorkspaceInvite(
  workspaceId: string,
  inviteId: string
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanInviteId = sanitizeDocId(inviteId);
  const path = `workspaces/${cleanWsId}/invites/${cleanInviteId}`;
  try {
    await updateDoc(doc(db, 'workspaces', cleanWsId, 'invites', cleanInviteId), {
      active: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function joinWorkspaceWithCode(
  uid: string,
  workspaceId: string,
  inviteCode: string,
  label: string
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId || DEFAULT_SHARED_WORKSPACE_ID);
  const cleanCode = inviteCode.trim().toUpperCase();
  if (cleanCode.length < 8 || !VALID_ID_REGEX.test(cleanCode)) {
    throw new Error('รูปแบบรหัสเชื่อมต่อไม่ถูกต้อง');
  }

  const invitePath = `workspaces/${cleanWsId}/invites/${cleanCode}`;
  let inviteSnap;
  try {
    inviteSnap = await getDoc(doc(db, 'workspaces', cleanWsId, 'invites', cleanCode));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
      throw new Error('รหัสเชื่อมต่อไม่ถูกต้องหรือถูกยกเลิกแล้ว');
    }
    handleFirestoreError(error, OperationType.GET, invitePath);
  }

  if (!inviteSnap.exists() || inviteSnap.data().active !== true) {
    throw new Error('รหัสเชื่อมต่อไม่ถูกต้องหรือหมดอายุแล้ว');
  }

  const workspaceOwnerId = String(inviteSnap.data().ownerId ?? '');
  if (!workspaceOwnerId) {
    throw new Error('ไม่พบข้อมูลผู้ดูแลฐานข้อมูล');
  }

  const existingMemberSnap = await getDoc(
    doc(db, 'workspaces', cleanWsId, 'members', uid)
  );
  if (!existingMemberSnap.exists()) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'workspaces', cleanWsId, 'members', uid), {
      uid,
      workspaceId: cleanWsId,
      workspaceOwnerId,
      role: 'member',
      label: (label.trim() || 'อุปกรณ์ร่วม').slice(0, 60),
      inviteToken: cleanCode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'workspaces', cleanWsId), {
      memberUids: arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}`);
    }
  }

  // Propagate member UID onto existing publicApps & devices so list queries include them immediately
  try {
    const idxSnap = await getDoc(doc(db, 'workspaces', cleanWsId, 'publicState', 'index'));
    if (idxSnap.exists()) {
      const idxData = idxSnap.data();
      const appIds: string[] = Array.isArray(idxData.appIds)
        ? idxData.appIds.map(String)
        : [];
      const deviceIds: string[] = Array.isArray(idxData.deviceIds)
        ? idxData.deviceIds.map(String)
        : [];

      if (appIds.length > 0 || deviceIds.length > 0) {
        const propBatch = writeBatch(db);
        appIds.slice(0, 200).forEach((appId) => {
          propBatch.update(doc(db, 'workspaces', cleanWsId, 'publicApps', appId), {
            memberUids: arrayUnion(uid),
            updatedAt: serverTimestamp(),
          });
        });
        deviceIds.slice(0, 50).forEach((devId) => {
          propBatch.update(doc(db, 'workspaces', cleanWsId, 'devices', devId), {
            memberUids: arrayUnion(uid),
            updatedAt: serverTimestamp(),
          });
        });
        await propBatch.commit();
      }
    }
  } catch {
    // Non-fatal if some doc was concurrently deleted
  }

  saveWorkspaceId(cleanWsId);
}

export async function propagateWorkspaceMembersToDocs(
  workspaceId: string,
  memberUids: string[]
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanMembers = Array.from(new Set(memberUids.map(sanitizeDocId))).slice(0, 20);
  if (cleanMembers.length === 0) return;

  try {
    const idxSnap = await getDoc(doc(db, 'workspaces', cleanWsId, 'publicState', 'index'));
    if (!idxSnap.exists()) return;
    const data = idxSnap.data();
    const appIds: string[] = Array.isArray(data.appIds) ? data.appIds.map(String) : [];
    const deviceIds: string[] = Array.isArray(data.deviceIds)
      ? data.deviceIds.map(String)
      : [];

    if (appIds.length === 0 && deviceIds.length === 0) return;

    const batch = writeBatch(db);
    appIds.slice(0, 200).forEach((appId) => {
      batch.update(doc(db, 'workspaces', cleanWsId, 'publicApps', appId), {
        memberUids: cleanMembers,
        updatedAt: serverTimestamp(),
      });
    });
    deviceIds.slice(0, 50).forEach((devId) => {
      batch.update(doc(db, 'workspaces', cleanWsId, 'devices', devId), {
        memberUids: cleanMembers,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch {
    // Ignore stale index entries during concurrent deletes
  }
}

export async function listWorkspaceMembers(
  uid: string,
  workspaceId: string,
  isOwner: boolean
): Promise<WorkspaceMemberInfo[]> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const path = `workspaces/${cleanWsId}/members`;
  const q = isOwner
    ? query(
        collection(db, 'workspaces', cleanWsId, 'members'),
        where('workspaceOwnerId', '==', uid)
      )
    : query(collection(db, 'workspaces', cleanWsId, 'members'), where('uid', '==', uid));

  let snap;
  try {
    snap = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }

  const now = Date.now();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: String(data.uid ?? d.id),
      role: data.role === 'owner' ? 'owner' : 'member',
      label: String(data.label ?? 'ผู้ร่วมใช้งาน'),
      updatedAt: toEpochMs(data.updatedAt, now),
    };
  });
}

export async function removeWorkspaceMember(
  workspaceId: string,
  targetUid: string
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanTarget = sanitizeDocId(targetUid);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'workspaces', cleanWsId, 'members', cleanTarget));
  batch.update(doc(db, 'workspaces', cleanWsId), {
    memberUids: arrayRemove(cleanTarget),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}`);
  }
}

export async function saveCloudSystemName(
  workspaceId: string,
  systemName: string
): Promise<string> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanName = sanitizeSystemName(systemName);
  const path = `workspaces/${cleanWsId}`;
  try {
    await updateDoc(doc(db, 'workspaces', cleanWsId), {
      systemName: cleanName,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
  return cleanName;
}

export async function syncPublicAppsToFirestore(
  uid: string,
  workspaceId: string,
  apps: PublicAppEntry[]
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const { ownerId, memberUids } = await getWorkspaceMetadata(uid, cleanWsId);

  const colPath = `workspaces/${cleanWsId}/publicApps`;
  const colRef = collection(db, 'workspaces', cleanWsId, 'publicApps');
  const q = query(colRef, where('memberUids', 'array-contains', uid));

  let existingSnap;
  try {
    existingSnap = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }

  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const incomingIds: string[] = [];
  const incomingIdSet = new Set<string>();
  const batch = writeBatch(db);

  apps.forEach((app, index) => {
    const sanitized = sanitizePublicAppPayload(cleanWsId, ownerId, memberUids, app, index);
    incomingIds.push(sanitized.id);
    incomingIdSet.add(sanitized.id);
    const docRef = doc(db, 'workspaces', cleanWsId, 'publicApps', sanitized.id);

    if (existingIds.has(sanitized.id)) {
      const updatePayload: Record<string, unknown> = {
        name: sanitized.name,
        logo_type: sanitized.logo_type,
        logo_value: sanitized.logo_value,
        target_url: sanitized.target_url,
        category: sanitized.category,
        sort_order: sanitized.sort_order,
        is_favorite: sanitized.is_favorite,
        memberUids: sanitized.memberUids,
        updatedAt: serverTimestamp(),
      };
      if (sanitized.lastUsedAt !== undefined) {
        updatePayload.lastUsedAt = sanitized.lastUsedAt;
      }
      batch.update(docRef, updatePayload);
    } else {
      batch.set(docRef, {
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  for (const oldDoc of existingSnap.docs) {
    if (!incomingIdSet.has(oldDoc.id)) {
      batch.delete(oldDoc.ref);
    }
  }

  const indexRef = doc(db, 'workspaces', cleanWsId, 'publicState', 'index');
  const idxSnap = await getDoc(indexRef);
  if (idxSnap.exists()) {
    batch.update(indexRef, {
      appIds: incomingIds.slice(0, 200),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(indexRef, {
      workspaceId: cleanWsId,
      ownerId,
      appIds: incomingIds.slice(0, 200),
      deviceIds: [],
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, colPath);
  }
}

export async function updatePublicAppLastUsedInFirestore(
  workspaceId: string,
  appId: string,
  lastUsedAt: number
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanId = sanitizeDocId(appId);
  const path = `workspaces/${cleanWsId}/publicApps/${cleanId}`;
  const ref = doc(db, 'workspaces', cleanWsId, 'publicApps', cleanId);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) return;

  try {
    await updateDoc(ref, {
      lastUsedAt: Math.max(0, Math.trunc(lastUsedAt)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function registerConnectedDevice(
  uid: string,
  workspaceId: string
): Promise<string> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const { memberUids } = await getWorkspaceMetadata(uid, cleanWsId);
  const cleanMembers = Array.from(new Set([...memberUids, uid].map(sanitizeDocId))).slice(0, 20);

  const device = getLocalDeviceIdentity();
  const path = `workspaces/${cleanWsId}/devices/${device.id}`;
  const ref = doc(db, 'workspaces', cleanWsId, 'devices', device.id);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (snap.exists()) {
    try {
      await updateDoc(ref, {
        deviceName: device.deviceName,
        platform: device.platform,
        memberUids: cleanMembers,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        workspaceId: cleanWsId,
        ownerId: uid,
        memberUids: cleanMembers,
        id: device.id,
        deviceName: device.deviceName,
        platform: device.platform,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  try {
    const idxRef = doc(db, 'workspaces', cleanWsId, 'publicState', 'index');
    const idxSnap = await getDoc(idxRef);
    if (idxSnap.exists()) {
      await updateDoc(idxRef, {
        deviceIds: arrayUnion(device.id),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // non-fatal
  }

  return device.id;
}

export async function removeConnectedDevice(
  workspaceId: string,
  deviceId: string
): Promise<void> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const cleanId = sanitizeDocId(deviceId);
  const path = `workspaces/${cleanWsId}/devices/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', cleanWsId, 'devices', cleanId));
    await updateDoc(doc(db, 'workspaces', cleanWsId, 'publicState', 'index'), {
      deviceIds: arrayRemove(cleanId),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveEncryptedVaultToFirestore(
  uid: string,
  workspaceId: string,
  envelope: EncryptedVaultEnvelopeV2
): Promise<void> {
  if (envelope.ciphertext.length > 850000) {
    throw new Error('ขนาดข้อมูล Vault เกินขีดจำกัดของเอกสาร Firestore (850KB)');
  }

  const cleanWsId = sanitizeDocId(workspaceId);
  const { ownerId } = await getWorkspaceMetadata(uid, cleanWsId);

  const path = `workspaces/${cleanWsId}/vaultData/primary`;
  const ref = doc(db, 'workspaces', cleanWsId, 'vaultData', 'primary');

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const sanitizedSlots = sanitizeKeySlots(envelope.keySlots);
  if (sanitizedSlots.length === 0) {
    throw new Error('ต้องมีบัญชีผู้ดูแลระบบอย่างน้อย 1 บัญชี');
  }

  const baseFields = {
    version: 2 as const,
    kdf: 'PBKDF2-SHA256' as const,
    iterations: Math.min(Math.max(Math.trunc(envelope.iterations), 100000), 2000000),
    cipher: 'AES-256-GCM' as const,
    iv: envelope.iv.slice(0, 64),
    ciphertext: envelope.ciphertext,
    keySlots: sanitizedSlots,
    clientUpdatedAt: Math.max(0, Math.trunc(envelope.updatedAt || Date.now())),
  };

  if (snap.exists()) {
    try {
      await updateDoc(ref, {
        ...baseFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        workspaceId: cleanWsId,
        ownerId,
        ...baseFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

export interface CloudWorkspaceSnapshot {
  systemName: string | null;
  publicApps: PublicAppEntry[] | null;
  envelope: EncryptedVaultEnvelopeV2 | null;
}

export async function fetchCloudWorkspaceState(
  uid: string,
  workspaceId: string
): Promise<CloudWorkspaceSnapshot> {
  const cleanWsId = sanitizeDocId(workspaceId);
  const { systemName } = await getWorkspaceMetadata(uid, cleanWsId);

  const appsPath = `workspaces/${cleanWsId}/publicApps`;
  const appsQuery = query(
    collection(db, 'workspaces', cleanWsId, 'publicApps'),
    where('memberUids', 'array-contains', uid)
  );

  let appsSnap;
  try {
    appsSnap = await getDocs(appsQuery);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, appsPath);
  }

  const cloudApps: PublicAppEntry[] = appsSnap.docs
    .map((d) => {
      const data = d.data();
      const now = Date.now();
      return {
        id: String(data.id ?? d.id),
        name: String(data.name ?? 'App'),
        logo_type: VALID_LOGO_TYPES.has(data.logo_type as LogoType)
          ? (data.logo_type as LogoType)
          : 'preset_icon',
        logo_value: String(data.logo_value ?? ''),
        target_url: String(data.target_url ?? ''),
        category: String(data.category ?? 'ทั่วไป'),
        sort_order: Number(data.sort_order ?? 0),
        is_favorite: Boolean(data.is_favorite),
        createdAt: toEpochMs(data.createdAt, now),
        updatedAt: toEpochMs(data.updatedAt, now),
        lastUsedAt:
          typeof data.lastUsedAt === 'number' ? data.lastUsedAt : undefined,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  const vaultPath = `workspaces/${cleanWsId}/vaultData/primary`;
  let vaultSnap;
  try {
    vaultSnap = await getDoc(doc(db, 'workspaces', cleanWsId, 'vaultData', 'primary'));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, vaultPath);
  }

  let cloudEnvelope: EncryptedVaultEnvelopeV2 | null = null;
  if (vaultSnap.exists()) {
    const v = vaultSnap.data();
    if (
      v.version === 2 &&
      v.kdf === 'PBKDF2-SHA256' &&
      v.cipher === 'AES-256-GCM' &&
      typeof v.iv === 'string' &&
      typeof v.ciphertext === 'string' &&
      Array.isArray(v.keySlots) &&
      v.keySlots.length > 0
    ) {
      cloudEnvelope = {
        version: 2,
        kdf: 'PBKDF2-SHA256',
        iterations: Number(v.iterations ?? 600000),
        cipher: 'AES-256-GCM',
        iv: v.iv,
        ciphertext: v.ciphertext,
        keySlots: v.keySlots as AdminKeySlot[],
        updatedAt: Number(v.clientUpdatedAt ?? toEpochMs(v.updatedAt, Date.now())),
      };
    }
  }

  return {
    systemName,
    publicApps: cloudApps.length > 0 ? cloudApps : null,
    envelope: cloudEnvelope,
  };
}

export function subscribeCloudWorkspace(
  uid: string,
  workspaceId: string,
  callbacks: {
    onSystemName: (name: string) => void;
    onMembersChanged: (memberUids: string[]) => void;
    onPublicApps: (apps: PublicAppEntry[]) => void;
    onEnvelope: (envelope: EncryptedVaultEnvelopeV2) => void;
    onDevices: (devices: SyncedDeviceInfo[]) => void;
    onError: (err: Error) => void;
  }
): Unsubscribe {
  const cleanWsId = sanitizeDocId(workspaceId);

  const wsPath = `workspaces/${cleanWsId}`;
  const unsubWorkspace = onSnapshot(
    doc(db, 'workspaces', cleanWsId),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (typeof data.systemName === 'string' && data.systemName.trim()) {
        callbacks.onSystemName(sanitizeSystemName(data.systemName));
      }
      if (Array.isArray(data.memberUids)) {
        callbacks.onMembersChanged((data.memberUids as string[]).map(String));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, wsPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const appsPath = `workspaces/${cleanWsId}/publicApps`;
  const appsQuery = query(
    collection(db, 'workspaces', cleanWsId, 'publicApps'),
    where('memberUids', 'array-contains', uid)
  );
  const unsubApps = onSnapshot(
    appsQuery,
    (snap) => {
      const now = Date.now();
      const apps: PublicAppEntry[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: String(data.id ?? d.id),
            name: String(data.name ?? 'App'),
            logo_type: VALID_LOGO_TYPES.has(data.logo_type as LogoType)
              ? (data.logo_type as LogoType)
              : 'preset_icon',
            logo_value: String(data.logo_value ?? ''),
            target_url: String(data.target_url ?? ''),
            category: String(data.category ?? 'ทั่วไป'),
            sort_order: Number(data.sort_order ?? 0),
            is_favorite: Boolean(data.is_favorite),
            createdAt: toEpochMs(data.createdAt, now),
            updatedAt: toEpochMs(data.updatedAt, now),
            lastUsedAt:
              typeof data.lastUsedAt === 'number' ? data.lastUsedAt : undefined,
          };
        })
        .sort((a, b) => a.sort_order - b.sort_order);
      callbacks.onPublicApps(apps);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, appsPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const vaultPath = `workspaces/${cleanWsId}/vaultData/primary`;
  const unsubVault = onSnapshot(
    doc(db, 'workspaces', cleanWsId, 'vaultData', 'primary'),
    (snap) => {
      if (!snap.exists()) return;
      const v = snap.data();
      if (
        v.version === 2 &&
        v.kdf === 'PBKDF2-SHA256' &&
        v.cipher === 'AES-256-GCM' &&
        typeof v.iv === 'string' &&
        typeof v.ciphertext === 'string' &&
        Array.isArray(v.keySlots) &&
        v.keySlots.length > 0
      ) {
        callbacks.onEnvelope({
          version: 2,
          kdf: 'PBKDF2-SHA256',
          iterations: Number(v.iterations ?? 600000),
          cipher: 'AES-256-GCM',
          iv: v.iv,
          ciphertext: v.ciphertext,
          keySlots: v.keySlots as AdminKeySlot[],
          updatedAt: Number(v.clientUpdatedAt ?? toEpochMs(v.updatedAt, Date.now())),
        });
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, vaultPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const devicesPath = `workspaces/${cleanWsId}/devices`;
  const devicesQuery = query(
    collection(db, 'workspaces', cleanWsId, 'devices'),
    where('memberUids', 'array-contains', uid)
  );
  const unsubDevices = onSnapshot(
    devicesQuery,
    (snap) => {
      const now = Date.now();
      const validPlatforms = new Set<DevicePlatform>([
        'desktop',
        'tablet',
        'mobile',
        'unknown',
      ]);
      const list: SyncedDeviceInfo[] = snap.docs
        .map((d) => {
          const data = d.data();
          const p = validPlatforms.has(data.platform as DevicePlatform)
            ? (data.platform as DevicePlatform)
            : 'unknown';
          return {
            id: String(data.id ?? d.id),
            deviceName: String(data.deviceName ?? 'อุปกรณ์'),
            platform: p,
            createdAt: toEpochMs(data.createdAt, now),
            updatedAt: toEpochMs(data.updatedAt, now),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      callbacks.onDevices(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, devicesPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  return () => {
    unsubWorkspace();
    unsubApps();
    unsubVault();
    unsubDevices();
  };
}
