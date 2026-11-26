import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  GripVertical,
  Home,
  KeyRound,
  LayoutGrid,
  List,
  Lock,
  Menu,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { AppDetailModal } from './components/AppDetailModal';
import { AppFormModal } from './components/AppFormModal';
import { AppLogo } from './components/AppLogo';
import { useFirebase } from './components/FirebaseProvider';
import { SecuritySettingsModal } from './components/SecuritySettingsModal';
import { SystemSettingsView } from './components/SystemSettingsView';
import { VaultGatePanel } from './components/VaultGatePanel';
import { getCategoryTheme } from './lib/categoryTheme';
import {
  createAdminKeySlot,
  decryptEnvelopeWithDek,
  decryptVaultWithSession,
  encryptVaultWithDek,
  generateVaultDek,
  unwrapAdminSlot,
  VAULT_SENTINEL,
} from './lib/crypto';
import {
  consumeWorkspaceInviteFromUrl,
  createPersonalSharedWorkspace,
  createWorkspaceInvite,
  DEFAULT_SHARED_WORKSPACE_ID,
  fetchCloudWorkspaceState,
  getLocalDeviceIdentity,
  getSavedWorkspaceId,
  joinWorkspaceWithCode,
  listWorkspaceInvites,
  listWorkspaceMembers,
  parseWorkspaceInviteInput,
  propagateWorkspaceMembersToDocs,
  registerConnectedDevice,
  removeConnectedDevice,
  removeWorkspaceMember,
  resolveSharedWorkspaceAccess,
  revokeWorkspaceInvite,
  saveCloudSystemName,
  saveEncryptedVaultToFirestore,
  subscribeCloudWorkspace,
  syncPublicAppsToFirestore,
  updatePublicAppLastUsedInFirestore,
} from './lib/firebaseSync';
import { createSampleApps } from './lib/sampleApps';
import {
  clearStoredEnvelope,
  downloadEncryptedBackup,
  getEnvelopeAdmins,
  getPublicAppsSource,
  loadPublicApps,
  loadStoredEnvelope,
  loadSystemName,
  savePublicApps,
  saveStoredEnvelope,
  saveSystemName,
  toPublicAppEntry,
} from './lib/storage';
import { validateTargetUrl } from './lib/urlSafety';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_NAME,
  type AdminKeySlot,
  type AdminRole,
  type AppItem,
  type DecryptedVaultPayload,
  type EncryptedVaultEnvelope,
  type EncryptedVaultEnvelopeV2,
  type LogoType,
  type PublicAppEntry,
  type SyncedDeviceInfo,
  type VaultSettings,
  type WorkspaceInviteInfo,
  type WorkspaceMemberInfo,
} from './types/vault';

type NavFilter =
  | { type: 'home' }
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'recent' }
  | { type: 'category'; category: string }
  | { type: 'system' };

interface ClipboardNotice {
  label: string;
  isSensitive: boolean;
  secondsLeft: number;
}

const THEME_PREF_KEY = 'keystone_theme_pref_v1';
const INITIAL_URL_INVITE = consumeWorkspaceInviteFromUrl();

function loadInitialPublicApps(): PublicAppEntry[] {
  // Clean up any legacy unencrypted workspace storage key
  try {
    localStorage.removeItem('keystone_apps_workspace_v1');
  } catch {
    // ignore storage errors
  }

  const existing = loadPublicApps();
  if (existing) {
    return existing;
  }

  const samples = createSampleApps().map(toPublicAppEntry);
  savePublicApps(samples, 'sample');
  return samples;
}

function loadInitialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_PREF_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export default function App() {
  const {
    authReady,
    user: firebaseUser,
    projectId,
    isSigningIn,
    authError,
    unauthorizedDomain,
    anonymousAuthDisabled,
    syncError,
    connectWithoutGoogle,
    signInWithGoogle,
    setSyncStatus,
    clearAuthError,
  } = useFirebase();

  const [publicApps, setPublicApps] = useState<PublicAppEntry[]>(() =>
    loadInitialPublicApps()
  );
  const [envelope, setEnvelope] = useState<EncryptedVaultEnvelope | null>(() =>
    loadStoredEnvelope()
  );
  const [connectedDevices, setConnectedDevices] = useState<SyncedDeviceInfo[]>([]);
  const currentDeviceId = useMemo(() => getLocalDeviceIdentity().id, []);

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() =>
    getSavedWorkspaceId()
  );
  const [isWorkspaceOwner, setIsWorkspaceOwner] = useState(false);
  const [workspaceInvites, setWorkspaceInvites] = useState<WorkspaceInviteInfo[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberInfo[]>([]);
  const [needsInvitePrompt, setNeedsInvitePrompt] = useState<{
    workspaceId: string;
  } | null>(null);
  const [inviteWsInput, setInviteWsInput] = useState(
    () => INITIAL_URL_INVITE.workspaceId || DEFAULT_SHARED_WORKSPACE_ID
  );
  const [inviteCodeInput, setInviteCodeInput] = useState(
    () => INITIAL_URL_INVITE.inviteCode || ''
  );
  const [inviteJoinError, setInviteJoinError] = useState<string | null>(null);
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);
  const [reconnectTick, setReconnectTick] = useState(0);

  const [systemName, setSystemName] = useState<string>(() => loadSystemName());
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [activeAdminId, setActiveAdminId] = useState<string | null>(null);
  const [vaultApps, setVaultApps] = useState<AppItem[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [settings, setSettings] = useState<VaultSettings>(() => ({
    ...DEFAULT_SETTINGS,
    theme: loadInitialTheme(),
  }));

  // Active 256-bit Data Encryption Key kept strictly in memory only while unlocked
  const dekRef = useRef<Uint8Array | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingActionRef = useRef<'add' | 'settings' | null>(null);
  const envelopeRef = useRef(envelope);
  const publicAppsRef = useRef(publicApps);
  const systemNameRef = useRef(systemName);
  const isUnlockedRef = useRef(isUnlocked);
  const activeAdminIdRef = useRef(activeAdminId);
  const workspaceIdRef = useRef(activeWorkspaceId);
  const needsInviteRef = useRef(needsInvitePrompt !== null);
  const pendingUrlInviteRef = useRef<{
    workspaceId?: string;
    inviteCode?: string;
  } | null>(INITIAL_URL_INVITE.inviteCode ? INITIAL_URL_INVITE : null);

  useEffect(() => {
    envelopeRef.current = envelope;
  }, [envelope]);

  useEffect(() => {
    publicAppsRef.current = publicApps;
  }, [publicApps]);

  useEffect(() => {
    systemNameRef.current = systemName;
  }, [systemName]);

  useEffect(() => {
    isUnlockedRef.current = isUnlocked;
  }, [isUnlocked]);

  useEffect(() => {
    activeAdminIdRef.current = activeAdminId;
  }, [activeAdminId]);

  useEffect(() => {
    workspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    needsInviteRef.current = needsInvitePrompt !== null;
  }, [needsInvitePrompt]);

  const [navFilter, setNavFilter] = useState<NavFilter>({ type: 'home' });
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppItem | null>(null);
  const [detailApp, setDetailApp] = useState<AppItem | null>(null);
  const [pendingDeleteApp, setPendingDeleteApp] = useState<AppItem | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const [clipboardNotice, setClipboardNotice] = useState<ClipboardNotice | null>(null);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);

  const lockVault = useCallback(() => {
    if (dekRef.current) {
      dekRef.current.fill(0);
      dekRef.current = null;
    }
    pendingActionRef.current = null;
    isUnlockedRef.current = false;
    activeAdminIdRef.current = null;
    setActiveAdminId(null);
    setVaultApps([]);
    setCustomCategories([]);
    setIsUnlocked(false);
    setShowAuthGate(false);
    setNavFilter({ type: 'home' });
    setDetailApp(null);
    setEditingApp(null);
    setPendingDeleteApp(null);
    setFormModalOpen(false);
    setSettingsModalOpen(false);
    setIdleSecondsLeft(null);
  }, []);

  const applyRemoteEncryptedEnvelope = useCallback(
    async (cloudEnv: EncryptedVaultEnvelopeV2) => {
      const activeDek = dekRef.current;
      if (!isUnlockedRef.current || !activeDek) return;

      const currentAdmin = activeAdminIdRef.current;
      if (
        currentAdmin &&
        !cloudEnv.keySlots.some((slot) => slot.id === currentAdmin)
      ) {
        lockVault();
        return;
      }

      try {
        const payload = await decryptEnvelopeWithDek(cloudEnv, activeDek);
        const sorted = [...payload.apps].sort((a, b) => a.sort_order - b.sort_order);
        const resolvedSystemName = saveSystemName(
          payload.settings?.systemName || systemNameRef.current || DEFAULT_SYSTEM_NAME
        );

        setVaultApps(sorted);
        setCustomCategories(payload.customCategories ?? []);
        setSystemName(resolvedSystemName);
        setSettings((prev) => ({
          ...DEFAULT_SETTINGS,
          ...payload.settings,
          theme: payload.settings?.theme ?? prev.theme,
          systemName: resolvedSystemName,
        }));

        const nextPublic = sorted.map(toPublicAppEntry);
        savePublicApps(nextPublic, 'cloud');
        setPublicApps(nextPublic);
      } catch {
        lockVault();
      }
    },
    [lockVault]
  );

  // Sync browser document title with systemName
  useEffect(() => {
    document.title = systemName;
  }, [systemName]);

  // Connect Firestore real-time cloud sync to shared workspace when Google Firebase user is authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setConnectedDevices([]);
      setWorkspaceInvites([]);
      setWorkspaceMembers([]);
      setIsWorkspaceOwner(false);
      setNeedsInvitePrompt(null);
      return;
    }
    const isCloudEligible = firebaseUser.isAnonymous || firebaseUser.emailVerified;
    if (!isCloudEligible) {
      setSyncStatus('error', 'บัญชีนี้ยังไม่ได้รับการยืนยันสำหรับการซิงก์');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let lastDeviceHeartbeat = 0;

    async function initCloudSync(
      uid: string,
      email: string | null | undefined,
      allowLegacyMigration: boolean
    ) {
      setSyncStatus('syncing');
      try {
        const targetWsId = workspaceIdRef.current || DEFAULT_SHARED_WORKSPACE_ID;

        const urlInvite = pendingUrlInviteRef.current;
        if (urlInvite?.inviteCode) {
          const inviteCode = urlInvite.inviteCode;
          pendingUrlInviteRef.current = null;
          const joinWs = urlInvite.workspaceId || DEFAULT_SHARED_WORKSPACE_ID;
          try {
            await joinWorkspaceWithCode(
              uid,
              joinWs,
              inviteCode,
              getLocalDeviceIdentity().deviceName
            );
            if (joinWs !== targetWsId) {
              workspaceIdRef.current = joinWs;
              setActiveWorkspaceId(joinWs);
              return;
            }
          } catch (joinErr) {
            if (!cancelled) {
              setInviteWsInput(joinWs);
              setInviteCodeInput(inviteCode);
              setInviteJoinError(
                joinErr instanceof Error
                  ? joinErr.message
                  : 'ไม่สามารถเชื่อมต่อด้วยลิงก์เชิญนี้ได้'
              );
            }
          }
        }

        const access = await resolveSharedWorkspaceAccess(
          uid,
          email,
          targetWsId,
          systemNameRef.current,
          allowLegacyMigration
        );
        if (cancelled) return;

        if (access.status === 'needs_invite') {
          setNeedsInvitePrompt({ workspaceId: access.workspaceId });
          setInviteWsInput(access.workspaceId);
          setConnectedDevices([]);
          setWorkspaceInvites([]);
          setWorkspaceMembers([]);
          setIsWorkspaceOwner(false);
          setSyncStatus('idle');
          return;
        }

        setNeedsInvitePrompt(null);
        setInviteJoinError(null);
        setIsWorkspaceOwner(access.isOwner);
        workspaceIdRef.current = access.workspaceId;

        if (access.isOwner && access.memberUids.length > 1) {
          await propagateWorkspaceMembersToDocs(
            access.workspaceId,
            access.memberUids,
            uid
          ).catch(() => {});
        }

        await registerConnectedDevice(uid, access.workspaceId);
        lastDeviceHeartbeat = Date.now();
        if (cancelled) return;

        const [cloud, members, invites] = await Promise.all([
          fetchCloudWorkspaceState(uid, access.workspaceId),
          listWorkspaceMembers(uid, access.workspaceId, access.isOwner).catch(() => []),
          access.isOwner
            ? listWorkspaceInvites(uid, access.workspaceId).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;

        setWorkspaceMembers(members);
        setWorkspaceInvites(invites);

        if (cloud.systemName) {
          const cleaned = saveSystemName(cloud.systemName);
          setSystemName(cleaned);
          setSettings((prev) => ({ ...prev, systemName: cleaned }));
        }

        const localEnv = envelopeRef.current;
        const localSource = getPublicAppsSource();
        const sameVault = Boolean(
          localEnv?.version === 2 &&
            cloud.envelope?.version === 2 &&
            localEnv.keySlots.some((ls) =>
              cloud.envelope!.keySlots.some((cs) => cs.id === ls.id)
            )
        );

        const pushingNewerSameVault = Boolean(
          localEnv &&
            localEnv.version === 2 &&
            (!cloud.envelope ||
              (sameVault && localEnv.updatedAt > cloud.envelope.updatedAt))
        );

        if (cloud.envelope) {
          if (
            !localEnv ||
            localEnv.version !== 2 ||
            !sameVault ||
            cloud.envelope.updatedAt > localEnv.updatedAt
          ) {
            saveStoredEnvelope(cloud.envelope);
            envelopeRef.current = cloud.envelope;
            setEnvelope(cloud.envelope);
            if (isUnlockedRef.current && dekRef.current) {
              await applyRemoteEncryptedEnvelope(cloud.envelope);
            }
          } else if (sameVault && localEnv.updatedAt > cloud.envelope.updatedAt) {
            await saveEncryptedVaultToFirestore(uid, access.workspaceId, localEnv);
            if (localSource !== 'sample') {
              await syncPublicAppsToFirestore(
                uid,
                access.workspaceId,
                publicAppsRef.current
              );
              savePublicApps(publicAppsRef.current, 'cloud');
            }
          }
        } else if (localEnv && localEnv.version === 2) {
          await saveEncryptedVaultToFirestore(uid, access.workspaceId, localEnv);
          if (localSource !== 'sample' || !cloud.hasSyncedPublicApps) {
            await syncPublicAppsToFirestore(
              uid,
              access.workspaceId,
              publicAppsRef.current
            );
            savePublicApps(publicAppsRef.current, 'cloud');
          }
        }

        if (!pushingNewerSameVault) {
          if (cloud.hasSyncedPublicApps) {
            savePublicApps(cloud.publicApps, 'cloud');
            setPublicApps(cloud.publicApps);
          } else if (publicAppsRef.current.length > 0) {
            await syncPublicAppsToFirestore(
              uid,
              access.workspaceId,
              publicAppsRef.current
            );
            savePublicApps(publicAppsRef.current, 'cloud');
          }
        }

        if (cancelled) return;
        setSyncStatus('synced');

        unsubscribe = subscribeCloudWorkspace(uid, access.workspaceId, {
          onSystemName: (cloudName) => {
            const cleaned = saveSystemName(cloudName);
            setSystemName(cleaned);
            setSettings((prev) => ({ ...prev, systemName: cleaned }));
          },
          onMembersChanged: (memberUids) => {
            if (!memberUids.includes(uid)) {
              setNeedsInvitePrompt({ workspaceId: access.workspaceId });
              setConnectedDevices([]);
              setWorkspaceMembers([]);
              setWorkspaceInvites([]);
              setIsWorkspaceOwner(false);
              return;
            }
            if (access.isOwner) {
              propagateWorkspaceMembersToDocs(
                access.workspaceId,
                memberUids,
                uid
              ).catch(() => {});
            }
            listWorkspaceMembers(uid, access.workspaceId, access.isOwner)
              .then((list) => {
                if (!cancelled) setWorkspaceMembers(list);
              })
              .catch(() => {});
          },
          onPublicApps: (cloudApps) => {
            savePublicApps(cloudApps, 'cloud');
            setPublicApps(cloudApps);
          },
          onEnvelope: (cloudEnv) => {
            const curr = envelopeRef.current;
            if (!curr || cloudEnv.updatedAt > curr.updatedAt) {
              saveStoredEnvelope(cloudEnv);
              envelopeRef.current = cloudEnv;
              setEnvelope(cloudEnv);
              if (isUnlockedRef.current && dekRef.current) {
                void applyRemoteEncryptedEnvelope(cloudEnv);
              }
            }
          },
          onDevices: (devices) => {
            setConnectedDevices(devices);
          },
          onError: (err) => {
            const msg = err.message.includes('Quota exceeded')
              ? 'โควตาการใช้งาน Firestore วันนี้เต็มแล้ว โควตาจะรีเซ็ตในวันถัดไป'
              : 'เกิดข้อผิดพลาดในการซิงก์ข้อมูลกับ Firebase';
            setSyncStatus('error', msg);
          },
        });
      } catch (err) {
        if (!cancelled) {
          const raw = err instanceof Error ? err.message : String(err);
          const msg = raw.includes('Quota exceeded')
            ? 'โควตาการใช้งาน Firestore วันนี้เต็มแล้ว โควตาจะรีเซ็ตในวันถัดไป'
            : 'ไม่สามารถเชื่อมต่อฐานข้อมูล Firebase ได้';
          setSyncStatus('error', msg);
        }
      }
    }

    initCloudSync(
      firebaseUser.uid,
      firebaseUser.email,
      Boolean(!firebaseUser.isAnonymous && firebaseUser.emailVerified)
    );

    const handleVisibilityRefresh = () => {
      if (
        document.visibilityState === 'visible' &&
        firebaseUser &&
        (firebaseUser.isAnonymous || firebaseUser.emailVerified) &&
        !needsInviteRef.current &&
        Date.now() - lastDeviceHeartbeat > 5 * 60 * 1000
      ) {
        lastDeviceHeartbeat = Date.now();
        registerConnectedDevice(firebaseUser.uid, workspaceIdRef.current).catch(
          () => {}
        );
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      if (unsubscribe) unsubscribe();
    };
  }, [
    authReady,
    firebaseUser,
    activeWorkspaceId,
    reconnectTick,
    setSyncStatus,
    applyRemoteEncryptedEnvelope,
  ]);

  // Keep open detail modal synced with real-time vault updates
  useEffect(() => {
    setDetailApp((prev) => {
      if (!prev) return null;
      return vaultApps.find((item) => item.id === prev.id) ?? null;
    });
  }, [vaultApps]);

  // Sync theme on <html> element & theme pref
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_PREF_KEY, settings.theme);
    } catch {
      // ignore
    }
  }, [settings.theme]);

  const persistEncryptedVault = useCallback(
    async (
      nextApps: AppItem[],
      nextCategories: string[],
      nextSettings: VaultSettings,
      overrideKeySlots?: AdminKeySlot[],
      overrideDek?: Uint8Array
    ) => {
      const dek = overrideDek ?? dekRef.current;
      if (!dek) {
        throw new Error('เซสชันถูกล็อก กรุณาปลดล็อกใหม่อีกครั้ง');
      }

      const currentEnv = envelopeRef.current;
      const keySlots =
        overrideKeySlots ?? (currentEnv?.version === 2 ? currentEnv.keySlots : []);
      if (keySlots.length === 0) {
        throw new Error('ไม่พบบัญชีผู้ดูแลระบบสำหรับเข้ารหัสคลัง');
      }

      const payload: DecryptedVaultPayload = {
        schemaVersion: 1,
        sentinel: VAULT_SENTINEL,
        apps: nextApps,
        customCategories: nextCategories,
        settings: nextSettings,
      };

      const nextEnvelope = await encryptVaultWithDek(payload, dek, keySlots);
      saveStoredEnvelope(nextEnvelope);
      envelopeRef.current = nextEnvelope;
      setEnvelope(nextEnvelope);

      const nextPublic = nextApps.map(toPublicAppEntry);
      savePublicApps(nextPublic, 'user');
      setPublicApps(nextPublic);

      if (
        firebaseUser &&
        (firebaseUser.isAnonymous || firebaseUser.emailVerified) &&
        !needsInviteRef.current
      ) {
        setSyncStatus('syncing');
        try {
          await saveEncryptedVaultToFirestore(
            firebaseUser.uid,
            workspaceIdRef.current,
            nextEnvelope
          );
          await syncPublicAppsToFirestore(
            firebaseUser.uid,
            workspaceIdRef.current,
            nextPublic
          );
          setSyncStatus('synced');
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          setSyncStatus(
            'error',
            raw.includes('Quota exceeded')
              ? 'โควตาการใช้งาน Firestore วันนี้เต็มแล้ว'
              : 'บันทึกในเครื่องแล้ว แต่ซิงก์ Firebase ไม่สำเร็จ'
          );
        }
      }
    },
    [firebaseUser, setSyncStatus]
  );

  // Activity tracking & Auto-Lock timer while unlocked
  useEffect(() => {
    if (!isUnlocked) return;

    const resetActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'keydown',
      'pointerdown',
      'scroll',
    ];
    events.forEach((evt) => window.addEventListener(evt, resetActivity, { passive: true }));

    const interval = window.setInterval(() => {
      if (settings.autoLockMinutes <= 0) {
        setIdleSecondsLeft(null);
        return;
      }
      const limitMs = settings.autoLockMinutes * 60 * 1000;
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((limitMs - elapsed) / 1000));
      setIdleSecondsLeft(remaining);
      if (remaining <= 0) {
        lockVault();
      }
    }, 1000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, resetActivity));
      window.clearInterval(interval);
    };
  }, [isUnlocked, settings.autoLockMinutes, lockVault]);

  // Global keyboard shortcuts: Cmd/Ctrl+K for Search, Cmd/Ctrl+L for Lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (isUnlocked && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lockVault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUnlocked, lockVault]);

  // Clipboard countdown & automatic clear
  useEffect(() => {
    if (!clipboardNotice) return;

    const timer = window.setInterval(() => {
      setClipboardNotice((prev) => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) {
          if (prev.isSensitive && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(' ').catch(() => {});
          }
          return null;
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [clipboardNotice !== null]);

  function fulfillPendingAction() {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action === 'add') {
      setEditingApp(null);
      setFormModalOpen(true);
    } else if (action === 'settings') {
      setSettingsModalOpen(true);
    }
  }

  async function handleCreateVault(params: {
    username: string;
    displayName: string;
    masterPassword: string;
  }) {
    // Seed encrypted credentials for current public apps so user keeps their Home apps seamlessly
    const sampleCredSource = createSampleApps();
    const initialVaultApps: AppItem[] = publicApps.map((pub) => {
      const sampleMatch = sampleCredSource.find((s) => s.name === pub.name);
      return {
        ...pub,
        credentials: sampleMatch
          ? sampleMatch.credentials
          : { username: '', password: '', notes: '' },
      };
    });

    const initialSettings: VaultSettings = {
      ...DEFAULT_SETTINGS,
      systemName,
      theme: settings.theme,
    };

    const newDek = generateVaultDek();
    const initialSlot = await createAdminKeySlot({
      username: params.username,
      displayName: params.displayName,
      role: 'super_admin',
      password: params.masterPassword,
      dekBytes: newDek,
    });

    await persistEncryptedVault(
      initialVaultApps,
      [],
      initialSettings,
      [initialSlot],
      newDek
    );
    dekRef.current = newDek;
    activeAdminIdRef.current = initialSlot.id;
    isUnlockedRef.current = true;
    setActiveAdminId(initialSlot.id);
    lastActivityRef.current = Date.now();
    setVaultApps(initialVaultApps);
    setCustomCategories([]);
    setSettings(initialSettings);
    setIsUnlocked(true);
    setShowAuthGate(false);
    setNavFilter({ type: 'all' });
    fulfillPendingAction();
  }

  async function handleUnlockVault(masterPassword: string, adminId?: string) {
    if (!envelope) {
      throw new Error('ไม่พบคลังข้อมูลในเบราว์เซอร์');
    }
    const res = await decryptVaultWithSession(envelope, masterPassword, adminId);
    const sorted = [...res.payload.apps].sort((a, b) => a.sort_order - b.sort_order);

    if (res.wasMigratedFromV1) {
      saveStoredEnvelope(res.envelope);
      envelopeRef.current = res.envelope;
      setEnvelope(res.envelope);
    }

    const resolvedSystemName = saveSystemName(
      res.payload.settings?.systemName || systemName || DEFAULT_SYSTEM_NAME
    );
    setSystemName(resolvedSystemName);

    dekRef.current = res.dekBytes;
    activeAdminIdRef.current = res.activeAdminId;
    isUnlockedRef.current = true;
    setActiveAdminId(res.activeAdminId);
    lastActivityRef.current = Date.now();
    setVaultApps(sorted);
    setCustomCategories(res.payload.customCategories ?? []);
    setSettings({
      ...DEFAULT_SETTINGS,
      ...res.payload.settings,
      systemName: resolvedSystemName,
    });
    setIsUnlocked(true);
    setShowAuthGate(false);
    setNavFilter({ type: 'all' });

    const prevPublic = publicAppsRef.current;
    const nextPublic = sorted.map(toPublicAppEntry);
    savePublicApps(nextPublic, 'user');
    setPublicApps(nextPublic);

    const publicAppsDiffer =
      prevPublic.length !== nextPublic.length ||
      nextPublic.some((item, idx) => {
        const prev = prevPublic[idx];
        return (
          !prev ||
          prev.id !== item.id ||
          prev.name !== item.name ||
          prev.target_url !== item.target_url ||
          prev.logo_type !== item.logo_type ||
          prev.logo_value !== item.logo_value ||
          prev.category !== item.category ||
          prev.sort_order !== item.sort_order ||
          prev.is_favorite !== item.is_favorite
        );
      });

    if (
      firebaseUser &&
      (firebaseUser.isAnonymous || firebaseUser.emailVerified) &&
      !needsInviteRef.current
    ) {
      if (res.wasMigratedFromV1) {
        saveEncryptedVaultToFirestore(
          firebaseUser.uid,
          workspaceIdRef.current,
          res.envelope
        ).catch(() => {});
      }
      if (res.wasMigratedFromV1 || publicAppsDiffer) {
        syncPublicAppsToFirestore(
          firebaseUser.uid,
          workspaceIdRef.current,
          nextPublic
        ).catch(() => {});
      }
    }

    fulfillPendingAction();
  }

  async function handleImportEnvelope(
    imported: EncryptedVaultEnvelope,
    masterPassword: string,
    adminId?: string
  ) {
    const res = await decryptVaultWithSession(imported, masterPassword, adminId);
    const sorted = [...res.payload.apps].sort((a, b) => a.sort_order - b.sort_order);

    saveStoredEnvelope(res.envelope);
    envelopeRef.current = res.envelope;
    setEnvelope(res.envelope);

    const resolvedSystemName = saveSystemName(
      res.payload.settings?.systemName || DEFAULT_SYSTEM_NAME
    );
    setSystemName(resolvedSystemName);

    dekRef.current = res.dekBytes;
    activeAdminIdRef.current = res.activeAdminId;
    isUnlockedRef.current = true;
    setActiveAdminId(res.activeAdminId);
    lastActivityRef.current = Date.now();
    setVaultApps(sorted);
    setCustomCategories(res.payload.customCategories ?? []);
    setSettings({
      ...DEFAULT_SETTINGS,
      ...res.payload.settings,
      systemName: resolvedSystemName,
    });
    setIsUnlocked(true);
    setShowAuthGate(false);
    setNavFilter({ type: 'all' });

    const nextPublic = sorted.map(toPublicAppEntry);
    savePublicApps(nextPublic, 'user');
    setPublicApps(nextPublic);

    if (
      firebaseUser &&
      (firebaseUser.isAnonymous || firebaseUser.emailVerified) &&
      !needsInviteRef.current
    ) {
      saveEncryptedVaultToFirestore(
        firebaseUser.uid,
        workspaceIdRef.current,
        res.envelope
      ).catch(() => {});
      syncPublicAppsToFirestore(
        firebaseUser.uid,
        workspaceIdRef.current,
        nextPublic
      ).catch(() => {});
    }

    fulfillPendingAction();
  }

  function handleResetVault() {
    clearStoredEnvelope();
    envelopeRef.current = null;
    setEnvelope(null);
    lockVault();
  }

  const allCategories = useMemo(() => {
    const set = new Set<string>([...DEFAULT_CATEGORIES, ...customCategories]);
    const source = isUnlocked ? vaultApps : publicApps;
    for (const app of source) {
      if (app.category.trim()) set.add(app.category.trim());
    }
    return Array.from(set);
  }, [isUnlocked, vaultApps, publicApps, customCategories]);

  async function handleSaveApp(data: {
    name: string;
    target_url: string;
    logo_type: LogoType;
    logo_value: string;
    category: string;
    is_favorite: boolean;
    username: string;
    password: string;
    notes: string;
  }) {
    const now = Date.now();
    let nextApps: AppItem[];

    if (editingApp) {
      nextApps = vaultApps.map((item) =>
        item.id === editingApp.id
          ? {
              ...item,
              name: data.name,
              target_url: data.target_url,
              logo_type: data.logo_type,
              logo_value: data.logo_value,
              category: data.category,
              is_favorite: data.is_favorite,
              credentials: {
                username: data.username,
                password: data.password,
                notes: data.notes,
              },
              updatedAt: now,
            }
          : item
      );
    } else {
      const maxOrder = vaultApps.reduce(
        (max, item) => Math.max(max, item.sort_order),
        -1
      );
      const newItem: AppItem = {
        id: crypto.randomUUID(),
        name: data.name,
        target_url: data.target_url,
        logo_type: data.logo_type,
        logo_value: data.logo_value,
        category: data.category,
        sort_order: maxOrder + 1,
        is_favorite: data.is_favorite,
        credentials: {
          username: data.username,
          password: data.password,
          notes: data.notes,
        },
        createdAt: now,
        updatedAt: now,
      };
      nextApps = [...vaultApps, newItem];
    }

    const nextCats = allCategories.includes(data.category)
      ? customCategories
      : [...customCategories, data.category];

    await persistEncryptedVault(nextApps, nextCats, settings);
    setVaultApps(nextApps);
    setCustomCategories(nextCats);
  }

  async function handleDeleteApp(id: string) {
    const nextApps = vaultApps
      .filter((a) => a.id !== id)
      .map((a, idx) => ({ ...a, sort_order: idx }));
    await persistEncryptedVault(nextApps, customCategories, settings);
    setVaultApps(nextApps);
  }

  async function handleToggleFavorite(app: AppItem) {
    const nextApps = vaultApps.map((item) =>
      item.id === app.id
        ? { ...item, is_favorite: !item.is_favorite, updatedAt: Date.now() }
        : item
    );
    await persistEncryptedVault(nextApps, customCategories, settings);
    setVaultApps(nextApps);
  }

  function handleLaunchPublicApp(app: PublicAppEntry) {
    const now = Date.now();
    const nextPublic = publicApps.map((item) =>
      item.id === app.id ? { ...item, lastUsedAt: now } : item
    );
    setPublicApps(nextPublic);
    savePublicApps(nextPublic, getPublicAppsSource());

    if (isUnlocked) {
      const nextVault = vaultApps.map((item) =>
        item.id === app.id ? { ...item, lastUsedAt: now } : item
      );
      setVaultApps(nextVault);
      persistEncryptedVault(nextVault, customCategories, settings).catch(() => {});
    } else if (
      firebaseUser &&
      (firebaseUser.isAnonymous || firebaseUser.emailVerified) &&
      !needsInviteRef.current
    ) {
      updatePublicAppLastUsedInFirestore(workspaceIdRef.current, app.id, now).catch(
        () => {}
      );
    }
  }

  async function handleUpdateSettings(partial: Partial<VaultSettings>) {
    const nextSettings = { ...settings, ...partial };
    setSettings(nextSettings);
    if (isUnlocked) {
      await persistEncryptedVault(vaultApps, customCategories, nextSettings);
    }
  }

  async function handleChangeMasterPassword(
    currentPassword: string,
    newPassword: string
  ) {
    if (!envelope || envelope.version !== 2) {
      throw new Error('ไม่พบไฟล์คลังข้อมูล');
    }
    const targetSlot =
      envelope.keySlots.find((s) => s.id === activeAdminId) ?? envelope.keySlots[0];
    if (!targetSlot) {
      throw new Error('ไม่พบบัญชีผู้ดูแลระบบที่ใช้งานอยู่');
    }

    let unwrappedDek: Uint8Array;
    try {
      unwrappedDek = await unwrapAdminSlot(
        targetSlot,
        currentPassword,
        envelope.iterations
      );
    } catch {
      throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }

    const updatedSlot = await createAdminKeySlot({
      id: targetSlot.id,
      username: targetSlot.username,
      displayName: targetSlot.displayName,
      role: targetSlot.role,
      password: newPassword,
      dekBytes: unwrappedDek,
      createdAt: targetSlot.createdAt,
    });
    unwrappedDek.fill(0);

    const nextSlots = envelope.keySlots.map((s) =>
      s.id === targetSlot.id ? updatedSlot : s
    );
    await persistEncryptedVault(vaultApps, customCategories, settings, nextSlots);
  }

  async function handleUpdateSystemName(nextName: string) {
    const cleaned = saveSystemName(nextName);
    setSystemName(cleaned);
    const nextSettings: VaultSettings = { ...settings, systemName: cleaned };
    setSettings(nextSettings);
    if (isUnlocked) {
      await persistEncryptedVault(vaultApps, customCategories, nextSettings);
    }
    if (
      firebaseUser &&
      (firebaseUser.isAnonymous || firebaseUser.emailVerified) &&
      !needsInviteRef.current
    ) {
      setSyncStatus('syncing');
      try {
        await saveCloudSystemName(workspaceIdRef.current, cleaned);
        setSyncStatus('synced');
      } catch (err) {
        setSyncStatus(
          'error',
          err instanceof Error ? err.message : 'ซิงก์ชื่อระบบขึ้น Firebase ไม่สำเร็จ'
        );
      }
    }
  }

  async function handleManualCloudSync() {
    if (
      !firebaseUser ||
      (!firebaseUser.isAnonymous && !firebaseUser.emailVerified) ||
      needsInviteRef.current
    ) {
      return;
    }
    const wsId = workspaceIdRef.current;
    setSyncStatus('syncing');
    try {
      await registerConnectedDevice(firebaseUser.uid, wsId);
      await saveCloudSystemName(wsId, systemName);
      await syncPublicAppsToFirestore(firebaseUser.uid, wsId, publicApps);
      if (envelope && envelope.version === 2) {
        await saveEncryptedVaultToFirestore(firebaseUser.uid, wsId, envelope);
      }
      setSyncStatus('synced');
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setSyncStatus(
        'error',
        raw.includes('Quota exceeded')
          ? 'โควตาการใช้งาน Firestore วันนี้เต็มแล้ว'
          : 'ซิงก์ข้อมูลขึ้น Firebase ไม่สำเร็จ'
      );
    }
  }

  async function handleRemoveDevice(deviceId: string) {
    if (
      !firebaseUser ||
      (!firebaseUser.isAnonymous && !firebaseUser.emailVerified) ||
      needsInviteRef.current
    ) {
      return;
    }
    await removeConnectedDevice(workspaceIdRef.current, deviceId);
  }

  async function handleCreateWorkspaceInvite() {
    if (!firebaseUser || (!firebaseUser.isAnonymous && !firebaseUser.emailVerified)) {
      throw new Error('กรุณาเชื่อมต่อซิงก์คลาวด์ก่อน');
    }
    const invite = await createWorkspaceInvite(
      firebaseUser.uid,
      workspaceIdRef.current
    );
    setWorkspaceInvites((prev) => [invite, ...prev]);
    return invite;
  }

  async function handleRevokeWorkspaceInvite(inviteId: string) {
    await revokeWorkspaceInvite(workspaceIdRef.current, inviteId);
    setWorkspaceInvites((prev) => prev.filter((item) => item.id !== inviteId));
  }

  async function handleRemoveWorkspaceMember(memberUid: string) {
    await removeWorkspaceMember(workspaceIdRef.current, memberUid);
    const updated = workspaceMembers.filter((m) => m.uid !== memberUid);
    setWorkspaceMembers(updated);
    if (isWorkspaceOwner && firebaseUser) {
      const nextUids = updated.map((m) => m.uid);
      if (nextUids.length > 0) {
        await propagateWorkspaceMembersToDocs(
          workspaceIdRef.current,
          nextUids,
          firebaseUser.uid
        );
      }
    }
  }

  async function handleJoinWorkspace(targetWsId: string, inviteCode: string) {
    if (!firebaseUser || (!firebaseUser.isAnonymous && !firebaseUser.emailVerified)) {
      throw new Error('กรุณาเชื่อมต่อซิงก์คลาวด์ก่อน');
    }
    const cleanWs = targetWsId.trim() || DEFAULT_SHARED_WORKSPACE_ID;
    await joinWorkspaceWithCode(
      firebaseUser.uid,
      cleanWs,
      inviteCode,
      getLocalDeviceIdentity().deviceName
    );
    setNeedsInvitePrompt(null);
    setInviteJoinError(null);
    setInviteCodeInput('');
    workspaceIdRef.current = cleanWs;
    setActiveWorkspaceId(cleanWs);
    setReconnectTick((t) => t + 1);
  }

  async function handleCreateOwnWorkspace() {
    if (!firebaseUser || (!firebaseUser.isAnonymous && !firebaseUser.emailVerified)) {
      return;
    }
    setIsJoiningInvite(true);
    setInviteJoinError(null);
    try {
      const res = await createPersonalSharedWorkspace(
        firebaseUser.uid,
        systemNameRef.current,
        Boolean(!firebaseUser.isAnonymous && firebaseUser.emailVerified)
      );
      setNeedsInvitePrompt(null);
      workspaceIdRef.current = res.workspaceId;
      setActiveWorkspaceId(res.workspaceId);
      setReconnectTick((t) => t + 1);
    } catch (err) {
      setInviteJoinError(
        err instanceof Error ? err.message : 'ไม่สามารถสร้างฐานข้อมูลส่วนตัวได้'
      );
    } finally {
      setIsJoiningInvite(false);
    }
  }

  async function handleQuickCloudAction() {
    if (!firebaseUser) {
      await connectWithoutGoogle();
      return;
    }
    if (isUnlocked) {
      setNavFilter({ type: 'system' });
      setShowAuthGate(false);
      setMobileMenuOpen(false);
    } else {
      setShowAuthGate(true);
      setMobileMenuOpen(false);
    }
  }

  async function handleAddAdmin(input: {
    username: string;
    displayName: string;
    role: AdminRole;
    password: string;
  }) {
    if (!envelope || envelope.version !== 2 || !dekRef.current) {
      throw new Error('เซสชันคลังรหัสยังไม่พร้อมใช้งาน');
    }
    const cleanUsername = input.username.trim();
    if (
      envelope.keySlots.some(
        (s) => s.username.toLowerCase() === cleanUsername.toLowerCase()
      )
    ) {
      throw new Error(`ชื่อผู้ใช้ "${cleanUsername}" ถูกใช้งานแล้ว`);
    }
    if (input.password.length < 8) {
      throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    }

    const newSlot = await createAdminKeySlot({
      username: cleanUsername,
      displayName: input.displayName.trim() || cleanUsername,
      role: input.role,
      password: input.password,
      dekBytes: dekRef.current,
    });

    const nextSlots = [...envelope.keySlots, newSlot];
    await persistEncryptedVault(vaultApps, customCategories, settings, nextSlots);
  }

  async function handleUpdateAdmin(input: {
    id: string;
    username: string;
    displayName: string;
    role: AdminRole;
    newPassword?: string;
  }) {
    if (!envelope || envelope.version !== 2 || !dekRef.current) {
      throw new Error('เซสชันคลังรหัสยังไม่พร้อมใช้งาน');
    }
    const existing = envelope.keySlots.find((s) => s.id === input.id);
    if (!existing) {
      throw new Error('ไม่พบบัญชีผู้ดูแลระบบที่ต้องการแก้ไข');
    }
    const cleanUsername = input.username.trim();
    if (
      envelope.keySlots.some(
        (s) =>
          s.id !== input.id &&
          s.username.toLowerCase() === cleanUsername.toLowerCase()
      )
    ) {
      throw new Error(`ชื่อผู้ใช้ "${cleanUsername}" ถูกใช้งานแล้ว`);
    }

    let updatedSlot: AdminKeySlot;
    if (input.newPassword && input.newPassword.length > 0) {
      if (input.newPassword.length < 8) {
        throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      }
      updatedSlot = await createAdminKeySlot({
        id: existing.id,
        username: cleanUsername,
        displayName: input.displayName.trim() || cleanUsername,
        role: input.role,
        password: input.newPassword,
        dekBytes: dekRef.current,
        createdAt: existing.createdAt,
      });
    } else {
      updatedSlot = {
        ...existing,
        username: cleanUsername,
        displayName: input.displayName.trim() || cleanUsername,
        role: input.role,
        updatedAt: Date.now(),
      };
    }

    const nextSlots = envelope.keySlots.map((s) =>
      s.id === input.id ? updatedSlot : s
    );
    await persistEncryptedVault(vaultApps, customCategories, settings, nextSlots);
  }

  async function handleDeleteAdmin(id: string) {
    if (!envelope || envelope.version !== 2) {
      throw new Error('เซสชันคลังรหัสยังไม่พร้อมใช้งาน');
    }
    if (id === activeAdminId) {
      throw new Error('ไม่สามารถลบบัญชี Admin ที่กำลังล็อกอินอยู่ได้');
    }
    if (envelope.keySlots.length <= 1) {
      throw new Error('ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี');
    }
    const nextSlots = envelope.keySlots.filter((s) => s.id !== id);
    await persistEncryptedVault(vaultApps, customCategories, settings, nextSlots);
  }

  async function handleCopyText(text: string, label: string, isSensitive: boolean) {
    try {
      await navigator.clipboard.writeText(text);
      setClipboardNotice({
        label,
        isSensitive,
        secondsLeft: isSensitive ? settings.clipboardClearSeconds : 4,
      });
    } catch {
      setClipboardNotice({
        label: 'เบราว์เซอร์ไม่อนุญาตการคัดลอกอัตโนมัติ',
        isSensitive: false,
        secondsLeft: 4,
      });
    }
  }

  async function handleDropReorder(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const fromIndex = vaultApps.findIndex((a) => a.id === draggedId);
    const toIndex = vaultApps.findIndex((a) => a.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...vaultApps];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((item, idx) => ({ ...item, sort_order: idx }));

    setVaultApps(normalized);
    setDraggedId(null);
    setDragOverId(null);
    await persistEncryptedVault(normalized, customCategories, settings);
  }

  const filteredHomeApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return publicApps;
    return publicApps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.target_url.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [publicApps, searchQuery]);

  const filteredVaultApps = useMemo(() => {
    let list = [...vaultApps];

    if (navFilter.type === 'favorites') {
      list = list.filter((a) => a.is_favorite);
    } else if (navFilter.type === 'recent') {
      list = list
        .filter((a) => Boolean(a.lastUsedAt))
        .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    } else if (navFilter.type === 'category') {
      list = list.filter((a) => a.category === navFilter.category);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.target_url.toLowerCase().includes(q) ||
          a.credentials.username.toLowerCase().includes(q)
      );
    }

    return list;
  }, [vaultApps, navFilter, searchQuery]);

  async function handleMoveApp(appId: string, direction: 'up' | 'down') {
    const visibleIndex = filteredVaultApps.findIndex((a) => a.id === appId);
    if (visibleIndex === -1) return;
    const neighborIndex = direction === 'up' ? visibleIndex - 1 : visibleIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= filteredVaultApps.length) return;

    const neighborId = filteredVaultApps[neighborIndex].id;
    const fromIndex = vaultApps.findIndex((a) => a.id === appId);
    const toIndex = vaultApps.findIndex((a) => a.id === neighborId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...vaultApps];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((item, idx) => ({ ...item, sort_order: idx }));

    setVaultApps(normalized);
    await persistEncryptedVault(normalized, customCategories, settings);
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of vaultApps) {
      counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
    }
    return counts;
  }, [vaultApps]);

  const vaultAdmins = useMemo(() => getEnvelopeAdmins(envelope), [envelope]);

  const adminListWithMeta = useMemo(() => {
    if (envelope?.version === 2) {
      return envelope.keySlots.map((slot) => ({
        id: slot.id,
        username: slot.username,
        displayName: slot.displayName,
        role: slot.role,
        createdAt: slot.createdAt,
        updatedAt: slot.updatedAt,
      }));
    }
    return [];
  }, [envelope]);

  const activeTitle =
    showAuthGate && !isUnlocked
      ? 'เข้าสู่ระบบคลังรหัส'
      : navFilter.type === 'home'
        ? 'หน้าหลัก'
        : navFilter.type === 'all'
          ? 'แอปทั้งหมด'
          : navFilter.type === 'favorites'
            ? 'รายการโปรด'
            : navFilter.type === 'recent'
              ? 'เปิดใช้งานล่าสุด'
              : navFilter.type === 'system'
                ? 'ตั้งค่าระบบ'
                : navFilter.category;

  const showLockGate = !isUnlocked && (showAuthGate || navFilter.type !== 'home');

  function handleProtectedAction(action: 'add' | 'settings') {
    if (isUnlocked) {
      if (action === 'add') {
        setEditingApp(null);
        setFormModalOpen(true);
      } else {
        setSettingsModalOpen(true);
      }
      return;
    }
    pendingActionRef.current = action;
    setShowAuthGate(true);
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#f6f8fc] bg-[radial-gradient(ellipse_at_top_left,_rgba(59,130,246,0.12),_transparent_50%),radial-gradient(ellipse_at_top_right,_rgba(16,185,129,0.09),_transparent_45%),radial-gradient(ellipse_at_bottom,_rgba(139,92,246,0.07),_transparent_55%)] dark:bg-[#070b14] dark:bg-[radial-gradient(ellipse_at_top_left,_rgba(59,130,246,0.16),_transparent_50%),radial-gradient(ellipse_at_top_right,_rgba(16,185,129,0.10),_transparent_45%),radial-gradient(ellipse_at_bottom,_rgba(99,102,241,0.10),_transparent_55%)] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-indigo-100/80 dark:border-slate-800/90">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-6">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => {
              setNavFilter({ type: 'home' });
              setShowAuthGate(false);
              setMobileMenuOpen(false);
            }}
            title={systemName}
            className="inline-flex items-center gap-2.5 text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer min-w-0"
          >
            <span
              aria-hidden="true"
              className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-xs shadow-indigo-500/25 shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
            </span>
            <span className="max-w-[150px] sm:max-w-[220px] truncate">{systemName}</span>
          </button>

          {/* Zone 2: Top Navigation Links */}
          <nav
            aria-label="เมนูหลัก"
            className={`${isUnlocked ? 'hidden xl:flex' : 'hidden md:flex'} items-center gap-5 text-sm font-medium`}
          >
            <button
              type="button"
              onClick={() => {
                setNavFilter({ type: 'home' });
                setShowAuthGate(false);
              }}
              className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                navFilter.type === 'home' && !showAuthGate
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300'
              }`}
            >
              <Home className="w-4 h-4 shrink-0" />
              <span>หน้าหลัก</span>
            </button>

            {isUnlocked && (
              <>
                <button
                  type="button"
                  onClick={() => setNavFilter({ type: 'all' })}
                  className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    navFilter.type === 'all' || navFilter.type === 'category'
                      ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4 shrink-0" />
                  <span>แอปทั้งหมด</span>
                </button>

                <button
                  type="button"
                  onClick={() => setNavFilter({ type: 'favorites' })}
                  className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    navFilter.type === 'favorites'
                      ? 'border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-400 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-300'
                  }`}
                >
                  <Star className="w-4 h-4 shrink-0" />
                  <span>รายการโปรด</span>
                </button>

                <button
                  type="button"
                  onClick={() => setNavFilter({ type: 'recent' })}
                  className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    navFilter.type === 'recent'
                      ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-300'
                  }`}
                >
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>ใช้งานล่าสุด</span>
                </button>

                <button
                  type="button"
                  onClick={() => setNavFilter({ type: 'system' })}
                  className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    navFilter.type === 'system'
                      ? 'border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-violet-600 dark:hover:text-violet-300'
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4 shrink-0" />
                  <span>ตั้งค่าระบบ</span>
                </button>
              </>
            )}
          </nav>

          {/* Zone 3: Cloud Sync + Theme Toggle + Vault Auth Action */}
          <div className={`${isUnlocked ? 'hidden xl:flex' : 'hidden md:flex'} items-center gap-2.5 shrink-0`}>
            <button
              type="button"
              onClick={handleQuickCloudAction}
              title="เชื่อมต่อทุกอุปกรณ์แบบ Real-time (Firebase)"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100/80 dark:hover:bg-sky-950/60 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{firebaseUser ? 'ซิงก์ทุกอุปกรณ์' : 'เชื่อมต่อทุกอุปกรณ์'}</span>
            </button>

            {isUnlocked && (
              <button
                type="button"
                onClick={() => handleProtectedAction('settings')}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>ความปลอดภัย</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({
                  theme: settings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              {settings.theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>โหมดสว่าง</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-600" />
                  <span>โหมดมืด</span>
                </>
              )}
            </button>

            {isUnlocked ? (
              <button
                type="button"
                onClick={lockVault}
                title="ล็อกคลังทันที (⌘L / Ctrl+L)"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors shadow-2xs"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  ล็อกคลัง
                  {idleSecondsLeft !== null
                    ? ` (${Math.floor(idleSecondsLeft / 60)}:${String(idleSecondsLeft % 60).padStart(2, '0')})`
                    : ''}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowAuthGate(true)}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm shadow-blue-600/20 cursor-pointer whitespace-nowrap shrink-0 transition-all"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>เข้าสู่ระบบคลังรหัส</span>
              </button>
            )}
          </div>

          {/* Mobile & Tablet Menu Toggle */}
          <div className={`flex ${isUnlocked ? 'xl:hidden' : 'md:hidden'} items-center gap-2 shrink-0`}>
            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({
                  theme: settings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              aria-label={settings.theme === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'}
              className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 flex items-center justify-center text-slate-700 dark:text-slate-200"
            >
              {settings.theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-600" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
              className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile & Tablet Dropdown Menu */}
        {mobileMenuOpen && (
          <div className={`${isUnlocked ? 'xl:hidden' : 'md:hidden'} border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 sm:px-6 py-3 space-y-1.5 max-h-[calc(100dvh-3.5rem)] overflow-y-auto`}>
            <button
              type="button"
              onClick={() => {
                setNavFilter({ type: 'home' });
                setShowAuthGate(false);
                setMobileMenuOpen(false);
              }}
              className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium ${
                navFilter.type === 'home' && !showAuthGate
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>หน้าหลัก</span>
            </button>

            {isUnlocked ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setNavFilter({ type: 'all' });
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium ${
                    navFilter.type === 'all' || navFilter.type === 'category'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span>แอปทั้งหมด ({vaultApps.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNavFilter({ type: 'favorites' });
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium ${
                    navFilter.type === 'favorites'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Star className="w-4 h-4" />
                  <span>รายการโปรด</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNavFilter({ type: 'recent' });
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium ${
                    navFilter.type === 'recent'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>เปิดใช้งานล่าสุด</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNavFilter({ type: 'system' });
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium ${
                    navFilter.type === 'system'
                      ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span>ตั้งค่าระบบ</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleProtectedAction('settings');
                  }}
                  className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  <Settings className="w-4 h-4" />
                  <span>ความปลอดภัย</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    lockVault();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold mt-1"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    ล็อกคลังทันที
                    {idleSecondsLeft !== null
                      ? ` (${Math.floor(idleSecondsLeft / 60)}:${String(idleSecondsLeft % 60).padStart(2, '0')})`
                      : ''}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowAuthGate(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold mt-1 shadow-sm shadow-blue-600/20"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>เข้าสู่ระบบคลังรหัส</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleQuickCloudAction}
              className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40"
            >
              <Cloud className="w-4 h-4" />
              <span>
                {firebaseUser
                  ? 'ซิงก์ทุกอุปกรณ์แบบ Real-time'
                  : 'เชื่อมต่อทุกอุปกรณ์ (Firebase)'}
              </span>
            </button>
          </div>
        )}
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 px-3.5 py-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-w-7xl w-full mx-auto space-y-4 sm:space-y-5">
        {!showLockGate && navFilter.type !== 'system' && (authError || syncError) && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-2 min-w-0">
                <p className={unauthorizedDomain || anonymousAuthDisabled ? 'leading-relaxed' : 'truncate'}>
                  {authError || syncError}
                </p>
                {anonymousAuthDisabled && (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`https://console.firebase.google.com/project/${projectId}/authentication/providers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                    >
                      <span>เปิด Firebase Console → เปิดใช้งาน Anonymous</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      disabled={isSigningIn}
                      onClick={() => void connectWithoutGoogle()}
                      className="px-2.5 py-1 rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-200 font-semibold hover:bg-rose-100/60 cursor-pointer disabled:opacity-60"
                    >
                      ลองเชื่อมต่อใหม่
                    </button>
                  </div>
                )}
                {unauthorizedDomain && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyText(
                          unauthorizedDomain,
                          `คัดลอกโดเมน ${unauthorizedDomain} แล้ว`,
                          false
                        )
                      }
                      className="px-2.5 py-1 rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-200 font-mono hover:bg-rose-100/60 cursor-pointer"
                    >
                      คัดลอกโดเมน: {unauthorizedDomain}
                    </button>
                    <a
                      href={`https://console.firebase.google.com/project/${projectId}/authentication/settings`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                    >
                      <span>เปิด Firebase Console → Authorized domains</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      className="px-2.5 py-1 rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-200 font-semibold hover:bg-rose-100/60 cursor-pointer"
                    >
                      ลองเชื่อมต่อใหม่
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                clearAuthError();
                setSyncStatus('idle', null);
              }}
              aria-label="ปิดการแจ้งเตือน"
              className="text-rose-600 dark:text-rose-400 hover:opacity-75 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {authReady &&
          !firebaseUser &&
          !isSigningIn &&
          !anonymousAuthDisabled &&
          !showLockGate &&
          navFilter.type === 'home' && (
            <section className="bg-white/95 dark:bg-slate-900/95 border border-sky-200 dark:border-sky-800/70 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <Cloud className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    เชื่อมต่อซิงก์คลาวด์ทุกอุปกรณ์ (ไม่ต้องใช้บัญชี Google)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    กดเชื่อมต่อเพื่อดึงและซิงก์รายการแอปจากฐานข้อมูลเดียวกันแบบ Real-time ได้ทันที
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void connectWithoutGoogle()}
                className="h-10 sm:h-9 px-4 rounded-lg bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 shadow-xs transition-all"
              >
                เชื่อมต่อซิงก์อัตโนมัติ
              </button>
            </section>
          )}

        {firebaseUser && needsInvitePrompt && (
          <section className="bg-white/95 dark:bg-slate-900/95 border border-sky-200 dark:border-sky-800/70 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <Cloud className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    เชื่อมต่ออุปกรณ์นี้เข้าฐานข้อมูลร่วม (ไม่ต้องใช้บัญชี Google)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    วางลิงก์เชิญ หรือกรอกรหัสเชื่อมต่อ (KV-XXXX-XXXX-XXXX) จากเครื่องหลักเพื่อซิงก์ทันที หรือสร้างฐานข้อมูลใหม่สำหรับอุปกรณ์นี้
                  </p>
                </div>
              </div>
            </div>

            {inviteJoinError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg px-3 py-2">
                {inviteJoinError}
              </p>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setInviteJoinError(null);
                const parsed = parseWorkspaceInviteInput(
                  inviteCodeInput,
                  inviteWsInput || needsInvitePrompt.workspaceId
                );
                if (!parsed.inviteCode) {
                  setInviteJoinError('กรุณาวางลิงก์เชิญ หรือกรอกรหัสเชื่อมต่อ');
                  return;
                }
                setIsJoiningInvite(true);
                try {
                  await handleJoinWorkspace(parsed.workspaceId, parsed.inviteCode);
                } catch (err) {
                  setInviteJoinError(
                    err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อฐานข้อมูลร่วมได้'
                  );
                } finally {
                  setIsJoiningInvite(false);
                }
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <input
                type="text"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                placeholder="วางลิงก์เชิญ หรือกรอกรหัส KV-XXXX-XXXX-XXXX"
                required
                className="flex-1 h-10 sm:h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                disabled={isJoiningInvite || !inviteCodeInput.trim()}
                className="h-10 sm:h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {isJoiningInvite ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อฐานข้อมูลร่วม'}
              </button>
              <button
                type="button"
                disabled={isJoiningInvite}
                onClick={handleCreateOwnWorkspace}
                className="h-10 sm:h-9 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                สร้างฐานข้อมูลส่วนตัวใหม่แทน
              </button>
            </form>
          </section>
        )}

        {/* Workspace Sub-Toolbar */}
        {!showLockGate && navFilter.type === 'system' && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <span>ตั้งค่าระบบ</span>
              <span className="text-indigo-300 dark:text-indigo-700" aria-hidden="true">
                /
              </span>
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                ชื่อระบบ &amp; ผู้ดูแล ({adminListWithMeta.length} บัญชี)
              </span>
            </div>
          </div>
        )}

        {!showLockGate && navFilter.type !== 'system' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                <span>{activeTitle}</span>
                <span className="text-indigo-300 dark:text-indigo-700" aria-hidden="true">
                  /
                </span>
                <span className="text-xs font-mono tabular-nums font-medium text-indigo-600 dark:text-indigo-400">
                  {navFilter.type === 'home'
                    ? filteredHomeApps.length
                    : filteredVaultApps.length}{' '}
                  รายการ
                </span>
              </div>

              {isUnlocked && navFilter.type !== 'home' && (
                <select
                  aria-label="กรองตามหมวดหมู่"
                  value={navFilter.type === 'category' ? navFilter.category : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      setNavFilter({ type: 'all' });
                    } else {
                      setNavFilter({ type: 'category', category: val });
                    }
                  }}
                  className="h-10 sm:h-9 w-full sm:w-auto px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">ทุกหมวดหมู่ ({vaultApps.length})</option>
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat} ({categoryCounts.get(cat) ?? 0})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-2.5 w-full sm:w-auto justify-end">
              <div className="relative flex-1 min-w-0 sm:w-64">
                <Search className="w-4 h-4 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    navFilter.type === 'home'
                      ? 'ค้นหาชื่อแอป (⌘K)'
                      : 'ค้นหาแอป, ลิงก์, อีเมล (⌘K)'
                  }
                  className="w-full h-10 sm:h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {isUnlocked && navFilter.type !== 'home' && (
                <div className="hidden md:flex items-center p-0.5 rounded-lg bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => handleUpdateSettings({ viewMode: 'grid' })}
                    aria-label="มุมมองการ์ด"
                    className={`w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
                      settings.viewMode === 'grid'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateSettings({ viewMode: 'table' })}
                    aria-label="มุมมองตาราง"
                    className={`w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
                      settings.viewMode === 'table'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                    }`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              )}

              {isUnlocked && (
                <button
                  type="button"
                  onClick={() => handleProtectedAction('add')}
                  className="inline-flex items-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm shadow-blue-600/20 cursor-pointer whitespace-nowrap shrink-0 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>เพิ่มแอปใหม่</span>
                </button>
              )}
            </div>
          </div>
        )}
          {showLockGate ? (
            <VaultGatePanel
              hasExistingVault={envelope !== null}
              admins={vaultAdmins}
              targetMenuTitle="คลังจัดการและรหัสผ่าน"
              onCreateVault={handleCreateVault}
              onUnlockVault={handleUnlockVault}
              onImportEnvelope={handleImportEnvelope}
              onResetVault={handleResetVault}
              onBackToHome={() => {
                pendingActionRef.current = null;
                setShowAuthGate(false);
                setNavFilter({ type: 'home' });
              }}
              lastUpdatedAt={envelope?.updatedAt}
            />
          ) : navFilter.type === 'system' ? (
            <SystemSettingsView
              systemName={systemName}
              admins={adminListWithMeta}
              activeAdminId={activeAdminId}
              onUpdateSystemName={handleUpdateSystemName}
              onAddAdmin={handleAddAdmin}
              onUpdateAdmin={handleUpdateAdmin}
              onDeleteAdmin={handleDeleteAdmin}
              onOpenSecurityModal={() => setSettingsModalOpen(true)}
              onSyncNow={handleManualCloudSync}
              connectedDevices={connectedDevices}
              currentDeviceId={currentDeviceId}
              onRemoveDevice={handleRemoveDevice}
              workspaceId={activeWorkspaceId}
              isWorkspaceOwner={isWorkspaceOwner}
              workspaceInvites={workspaceInvites}
              workspaceMembers={workspaceMembers}
              onCreateWorkspaceInvite={handleCreateWorkspaceInvite}
              onRevokeWorkspaceInvite={handleRevokeWorkspaceInvite}
              onRemoveWorkspaceMember={handleRemoveWorkspaceMember}
              onJoinWorkspace={handleJoinWorkspace}
            />
          ) : navFilter.type === 'home' ? (
            filteredHomeApps.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center max-w-lg mx-auto mt-8">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {searchQuery ? 'ไม่พบแอปที่ตรงกับคำค้นหา' : 'ยังไม่มีแอปในหน้าหลัก'}
                </h2>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {searchQuery
                    ? 'ลองเปลี่ยนคำค้นหาใหม่อีกครั้ง'
                    : 'เข้าสู่ระบบคลังรหัสเพื่อเพิ่มรายการแอปของคุณ'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {filteredHomeApps.map((app) => {
                  const urlCheck = validateTargetUrl(app.target_url);
                  const theme = getCategoryTheme(app.category);
                  if (!urlCheck.valid) {
                    return (
                      <div
                        key={app.id}
                        className="relative overflow-hidden bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 min-h-[124px] sm:min-h-[140px] flex flex-col items-center justify-center text-center gap-3 opacity-60"
                      >
                        <AppLogo
                          name={app.name}
                          logoType={app.logo_type}
                          logoValue={app.logo_value}
                          targetUrl={app.target_url}
                          size="lg"
                        />
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                          {app.name}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <a
                      key={app.id}
                      href={urlCheck.normalizedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleLaunchPublicApp(app)}
                      className={`group relative overflow-hidden bg-white/90 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 min-h-[124px] sm:min-h-[140px] flex flex-col items-center justify-center text-center gap-3 transition-all hover:-translate-y-1 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${theme.tileHoverClass}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${theme.topBarClass} opacity-75 group-hover:opacity-100 transition-opacity`}
                      />
                      <div className={`rounded-2xl transition-all ${theme.iconGlowClass}`}>
                        <AppLogo
                          name={app.name}
                          logoType={app.logo_type}
                          logoValue={app.logo_value}
                          targetUrl={app.target_url}
                          size="lg"
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 transition-colors line-clamp-2">
                        {app.name}
                      </span>
                    </a>
                  );
                })}
              </div>
            )
          ) : filteredVaultApps.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center max-w-lg mx-auto mt-8">
              <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {searchQuery
                  ? 'ไม่พบแอปที่ตรงกับคำค้นหา'
                  : 'ยังไม่มีรายการแอปในหมวดนี้'}
              </h2>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {searchQuery
                  ? 'ลองเปลี่ยนคำค้นหา หรือเลือกดูรายการจากหมวดหมู่ทั้งหมด'
                  : 'เพิ่มแอปพลิเคชันที่ใช้บ่อย พร้อมตั้งค่าโลโก้ ลิงก์/Deep Link และบันทึกรหัสผ่านที่เข้ารหัสด้วย AES-256-GCM'}
              </p>
              <div className="mt-5 flex items-center justify-center gap-2">
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    ล้างคำค้นหา
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingApp(null);
                      setFormModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>เพิ่มแอปแรกของคุณ</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {settings.viewMode === 'table' && (
                <div className="hidden md:block bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-gradient-to-r from-slate-50 via-blue-50/50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/30">
                          <th className="py-3 px-4">แอปพลิเคชัน</th>
                          <th className="py-3 px-4">หมวดหมู่</th>
                          <th className="py-3 px-4">ชื่อผู้ใช้ / อีเมล</th>
                          <th className="py-3 px-4 text-right">การจัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 text-sm">
                        {filteredVaultApps.map((app) => {
                          const urlCheck = validateTargetUrl(app.target_url);
                          const theme = getCategoryTheme(app.category);
                          return (
                            <tr
                              key={app.id}
                              className="hover:bg-blue-50/35 dark:hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="py-2.5 px-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <AppLogo
                                    name={app.name}
                                    logoType={app.logo_type}
                                    logoValue={app.logo_value}
                                    targetUrl={app.target_url}
                                    size="sm"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                      {app.name}
                                    </div>
                                    <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                                      {urlCheck.displayHost || app.target_url}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className={`py-2.5 px-4 text-xs font-medium whitespace-nowrap ${theme.textAccentClass}`}>
                                {app.category}
                              </td>
                              <td className="py-2.5 px-4 text-xs text-slate-700 dark:text-slate-300 max-w-[220px] truncate">
                                {app.credentials.username || '—'}
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="flex items-center justify-end gap-1.5">
                                  {app.credentials.username && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCopyText(
                                          app.credentials.username,
                                          `คัดลอกชื่อผู้ใช้ของ ${app.name} แล้ว`,
                                          false
                                        )
                                      }
                                      className="px-2.5 py-1.5 rounded-md border border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/60 cursor-pointer whitespace-nowrap transition-colors"
                                    >
                                      คัดลอกผู้ใช้
                                    </button>
                                  )}
                                  {app.credentials.password && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCopyText(
                                          app.credentials.password,
                                          `คัดลอกรหัสผ่านของ ${app.name} แล้ว`,
                                          true
                                        )
                                      }
                                      className="px-2.5 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 cursor-pointer whitespace-nowrap transition-colors"
                                    >
                                      คัดลอกรหัส
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setDetailApp(app)}
                                    className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300 cursor-pointer whitespace-nowrap transition-colors"
                                  >
                                    รายละเอียด
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingApp(app);
                                      setFormModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/30 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer whitespace-nowrap transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    <span>แก้ไข</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteApp(app)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer whitespace-nowrap transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>ลบ</span>
                                  </button>
                                  {urlCheck.valid && (
                                    <a
                                      href={urlCheck.normalizedUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={() => handleLaunchPublicApp(app)}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold whitespace-nowrap shadow-2xs transition-all"
                                    >
                                      <span>เปิด</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className={settings.viewMode === 'table' ? 'md:hidden space-y-3' : 'space-y-3'}>
                {navFilter.type !== 'recent' && !searchQuery && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ลากวางหรือกดปุ่มลูกศรเพื่อจัดเรียงลำดับแอปตามต้องการ (บันทึกลำดับลงใน Vault อัตโนมัติ)
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4">
                  {filteredVaultApps.map((app, index) => {
                    const urlCheck = validateTargetUrl(app.target_url);
                    const theme = getCategoryTheme(app.category);
                    const isDragOver = dragOverId === app.id && draggedId !== app.id;
                    const canReorder = navFilter.type !== 'recent' && !searchQuery;

                    return (
                      <article
                        key={app.id}
                        draggable={canReorder}
                        onDragStart={() => setDraggedId(app.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragOverId !== app.id) setDragOverId(app.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverId === app.id) setDragOverId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDropReorder(app.id);
                        }}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDragOverId(null);
                        }}
                        className={`group relative overflow-hidden bg-white/95 dark:bg-slate-900/95 border rounded-xl p-4 flex flex-col justify-between transition-all hover:shadow-md ${
                          isDragOver
                            ? 'border-indigo-500 ring-2 ring-indigo-500/25'
                            : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${theme.topBarClass} opacity-85`}
                        />

                        <div>
                          {/* Card Top Row */}
                          <div className="flex items-start justify-between gap-2.5 pt-0.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <AppLogo
                                name={app.name}
                                logoType={app.logo_type}
                                logoValue={app.logo_value}
                                targetUrl={app.target_url}
                                size="md"
                              />
                              <div className="min-w-0">
                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {app.name}
                                </h3>
                                <div className="flex items-center gap-1.5 text-xs truncate">
                                  <span className={`shrink-0 font-medium ${theme.textAccentClass}`}>
                                    {app.category}
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                                    ·
                                  </span>
                                  <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                                    {urlCheck.displayHost || app.target_url}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-0.5 shrink-0">
                              {canReorder && (
                                <div className="flex items-center md:hidden">
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => handleMoveApp(app.id, 'up')}
                                    aria-label={`เลื่อน ${app.name} ขึ้น`}
                                    className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === filteredVaultApps.length - 1}
                                    onClick={() => handleMoveApp(app.id, 'down')}
                                    aria-label={`เลื่อน ${app.name} ลง`}
                                    className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleFavorite(app)}
                                aria-label={
                                  app.is_favorite
                                    ? 'นำออกจากรายการโปรด'
                                    : 'เพิ่มในรายการโปรด'
                                }
                                className={`w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                                  app.is_favorite
                                    ? 'text-amber-500 bg-amber-50/80 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60'
                                    : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <Star
                                  className={`w-4 h-4 ${app.is_favorite ? 'fill-current' : ''}`}
                                />
                              </button>
                              {canReorder && (
                                <span
                                  title="ลากเพื่อจัดเรียง"
                                  className="hidden md:flex w-7 h-8 items-center justify-center text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-4 h-4" />
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Credential Preview Line */}
                          <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-600 dark:text-slate-400 truncate">
                              {app.credentials.username || 'ยังไม่ได้ระบุชื่อผู้ใช้'}
                            </span>
                            <span className="font-mono text-slate-400 dark:text-slate-500 shrink-0">
                              {app.credentials.password ? '••••••••' : 'ไม่มีรหัสผ่าน'}
                            </span>
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!app.credentials.username}
                              onClick={() =>
                                handleCopyText(
                                  app.credentials.username,
                                  `คัดลอกชื่อผู้ใช้ของ ${app.name} แล้ว`,
                                  false
                                )
                              }
                              title="คัดลอกชื่อผู้ใช้"
                              className="inline-flex items-center gap-1 h-10 sm:h-8 px-2.5 rounded-lg border border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors"
                            >
                              <User className="w-3.5 h-3.5" />
                              <span>ผู้ใช้</span>
                            </button>

                            <button
                              type="button"
                              disabled={!app.credentials.password}
                              onClick={() =>
                                handleCopyText(
                                  app.credentials.password,
                                  `คัดลอกรหัสผ่านของ ${app.name} แล้ว`,
                                  true
                                )
                              }
                              title="คัดลอกรหัสผ่าน (ล้างอัตโนมัติ)"
                              className="inline-flex items-center gap-1 h-10 sm:h-8 px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>รหัส</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setDetailApp(app)}
                              title="ดูรายละเอียด"
                              aria-label={`ดูรายละเอียด ${app.name}`}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300 cursor-pointer transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setEditingApp(app);
                                setFormModalOpen(true);
                              }}
                              title="แก้ไขข้อมูลแอป"
                              aria-label={`แก้ไข ${app.name}`}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/30 flex items-center justify-center text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setPendingDeleteApp(app)}
                              title="ลบแอป"
                              aria-label={`ลบ ${app.name}`}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {urlCheck.valid ? (
                            <a
                              href={urlCheck.normalizedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => handleLaunchPublicApp(app)}
                              className="inline-flex items-center gap-1.5 h-10 sm:h-8 px-3.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 ml-auto shadow-2xs transition-all"
                            >
                              <span>เปิดแอป</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-xs text-rose-600 dark:text-rose-400 ml-auto">
                              ลิงก์ไม่ถูกต้อง
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </main>

      {/* Clipboard Auto-Clear Countdown Toast */}
      {clipboardNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 inset-x-3.5 sm:inset-x-auto sm:right-4 z-50 sm:max-w-sm mb-[env(safe-area-inset-bottom)] bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur-md text-white border border-indigo-500/40 rounded-xl px-4 py-3 shadow-xl shadow-indigo-950/20 flex items-center justify-between gap-4"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{clipboardNotice.label}</p>
            {clipboardNotice.isSensitive && (
              <p className="text-xs text-emerald-300 mt-0.5 tabular-nums">
                ล้าง Clipboard อัตโนมัติใน {clipboardNotice.secondsLeft} วินาที
              </p>
            )}
          </div>
          {clipboardNotice.isSensitive && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(' ').catch(() => {});
                setClipboardNotice(null);
              }}
              className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              ล้างทันที
            </button>
          )}
        </div>
      )}

      {/* Protected Modals (rendered only when unlocked) */}
      {isUnlocked && (
        <>
          <AppFormModal
            isOpen={formModalOpen}
            editingApp={editingApp}
            categories={allCategories}
            onClose={() => {
              setFormModalOpen(false);
              setEditingApp(null);
            }}
            onSave={handleSaveApp}
          />

          <AppDetailModal
            app={detailApp}
            onClose={() => setDetailApp(null)}
            onEdit={(app) => {
              setEditingApp(app);
              setFormModalOpen(true);
            }}
            onDelete={handleDeleteApp}
            onCopyUsername={(u) =>
              handleCopyText(u, 'คัดลอกชื่อผู้ใช้แล้ว', false)
            }
            onCopyPassword={(p) =>
              handleCopyText(p, 'คัดลอกรหัสผ่านแล้ว', true)
            }
            onLaunch={handleLaunchPublicApp}
          />

          <SecuritySettingsModal
            isOpen={settingsModalOpen}
            settings={settings}
            envelope={envelope}
            appCount={vaultApps.length}
            onClose={() => setSettingsModalOpen(false)}
            onUpdateSettings={handleUpdateSettings}
            onChangeMasterPassword={handleChangeMasterPassword}
            onExportBackup={() => {
              if (envelope) downloadEncryptedBackup(envelope, systemName);
            }}
          />

          {pendingDeleteApp && (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
            >
              <div className="w-full max-w-sm bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-xl">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  ยืนยันลบ "{pendingDeleteApp.name}"?
                </h2>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  รายการแอป โลโก้ ลิงก์ และรหัสผ่านที่บันทึกไว้สำหรับแอปนี้จะถูกลบออกจากคลังถาวร
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingDeleteApp(null)}
                    className="h-11 sm:h-9 px-4 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const idToDelete = pendingDeleteApp.id;
                      setPendingDeleteApp(null);
                      await handleDeleteApp(idToDelete);
                    }}
                    className="h-11 sm:h-9 px-4 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white cursor-pointer whitespace-nowrap"
                  >
                    ลบถาวร
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
