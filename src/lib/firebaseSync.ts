import {
  collection,
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
  type EncryptedVaultEnvelopeV2,
  type LogoType,
  type PublicAppEntry,
} from '../types/vault';
import { db, handleFirestoreError, OperationType } from './firebase';

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

interface SanitizedPublicAppPayload {
  ownerId: string;
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
  uid: string,
  app: PublicAppEntry,
  index: number
): SanitizedPublicAppPayload {
  const cleanId = sanitizeDocId(app.id);
  const logoType: LogoType = VALID_LOGO_TYPES.has(app.logo_type)
    ? app.logo_type
    : 'preset_icon';
  const sortOrder = Math.min(Math.max(Math.trunc(app.sort_order ?? index), 0), 10000);
  const base: SanitizedPublicAppPayload = {
    ownerId: uid,
    id: cleanId,
    name: (app.name.trim() || 'App').slice(0, 100),
    logo_type: logoType,
    logo_value: (app.logo_value ?? '').slice(0, 200000),
    target_url: (app.target_url.trim() || 'https://example.com').slice(0, 2048),
    category: (app.category.trim() || 'ทั่วไป').slice(0, 60),
    sort_order: sortOrder,
    is_favorite: Boolean(app.is_favorite),
  };

  if (typeof app.lastUsedAt === 'number' && Number.isFinite(app.lastUsedAt) && app.lastUsedAt >= 0) {
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

export async function ensureUserWorkspace(
  uid: string,
  systemName: string
): Promise<{ systemName: string; existed: boolean }> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (snap.exists()) {
    const data = snap.data();
    const existingName =
      typeof data.systemName === 'string' && data.systemName.trim()
        ? sanitizeSystemName(data.systemName)
        : DEFAULT_SYSTEM_NAME;
    return { systemName: existingName, existed: true };
  }

  const cleanName = sanitizeSystemName(systemName);
  try {
    await setDoc(ref, {
      uid,
      systemName: cleanName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return { systemName: cleanName, existed: false };
}

export async function saveCloudSystemName(
  uid: string,
  systemName: string
): Promise<string> {
  const cleanName = sanitizeSystemName(systemName);
  const path = `users/${uid}`;
  const { existed } = await ensureUserWorkspace(uid, cleanName);

  if (existed) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        systemName: cleanName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  return cleanName;
}

export async function syncPublicAppsToFirestore(
  uid: string,
  apps: PublicAppEntry[],
  systemName: string
): Promise<void> {
  await ensureUserWorkspace(uid, systemName);

  const colPath = `users/${uid}/publicApps`;
  const colRef = collection(db, 'users', uid, 'publicApps');
  const q = query(colRef, where('ownerId', '==', uid));

  let existingSnap;
  try {
    existingSnap = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }

  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const incomingIds = new Set<string>();
  const batch = writeBatch(db);

  apps.forEach((app, index) => {
    const sanitized = sanitizePublicAppPayload(uid, app, index);
    incomingIds.add(sanitized.id);
    const docRef = doc(db, 'users', uid, 'publicApps', sanitized.id);

    if (existingIds.has(sanitized.id)) {
      const updatePayload: Record<string, unknown> = {
        name: sanitized.name,
        logo_type: sanitized.logo_type,
        logo_value: sanitized.logo_value,
        target_url: sanitized.target_url,
        category: sanitized.category,
        sort_order: sanitized.sort_order,
        is_favorite: sanitized.is_favorite,
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
    if (!incomingIds.has(oldDoc.id)) {
      batch.delete(oldDoc.ref);
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, colPath);
  }
}

export async function saveEncryptedVaultToFirestore(
  uid: string,
  envelope: EncryptedVaultEnvelopeV2,
  systemName: string
): Promise<void> {
  if (envelope.ciphertext.length > 850000) {
    throw new Error('ขนาดข้อมูล Vault เกินขีดจำกัดของเอกสาร Firestore (850KB)');
  }

  await ensureUserWorkspace(uid, systemName);

  const path = `users/${uid}/vaultData/primary`;
  const ref = doc(db, 'users', uid, 'vaultData', 'primary');

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
        ownerId: uid,
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
  fallbackSystemName: string
): Promise<CloudWorkspaceSnapshot> {
  const { systemName } = await ensureUserWorkspace(uid, fallbackSystemName);

  const appsPath = `users/${uid}/publicApps`;
  const appsQuery = query(
    collection(db, 'users', uid, 'publicApps'),
    where('ownerId', '==', uid)
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

  const vaultPath = `users/${uid}/vaultData/primary`;
  let vaultSnap;
  try {
    vaultSnap = await getDoc(doc(db, 'users', uid, 'vaultData', 'primary'));
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
  callbacks: {
    onSystemName: (name: string) => void;
    onPublicApps: (apps: PublicAppEntry[]) => void;
    onEnvelope: (envelope: EncryptedVaultEnvelopeV2) => void;
    onError: (err: Error) => void;
  }
): Unsubscribe {
  const userPath = `users/${uid}`;
  const unsubUser = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        const name = snap.data().systemName;
        if (typeof name === 'string' && name.trim()) {
          callbacks.onSystemName(sanitizeSystemName(name));
        }
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, userPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const appsPath = `users/${uid}/publicApps`;
  const appsQuery = query(
    collection(db, 'users', uid, 'publicApps'),
    where('ownerId', '==', uid)
  );
  const unsubApps = onSnapshot(
    appsQuery,
    (snap) => {
      if (snap.empty) return;
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

  const vaultPath = `users/${uid}/vaultData/primary`;
  const unsubVault = onSnapshot(
    doc(db, 'users', uid, 'vaultData', 'primary'),
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

  return () => {
    unsubUser();
    unsubApps();
    unsubVault();
  };
}
