import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { auth, firebaseProjectInfo, googleProvider } from '../lib/firebase';

export type CloudSyncState = 'idle' | 'syncing' | 'synced' | 'error';

interface FirebaseContextValue {
  authReady: boolean;
  user: User | null;
  projectId: string;
  firestoreDatabaseId: string;
  isSigningIn: boolean;
  authError: string | null;
  unauthorizedDomain: string | null;
  syncState: CloudSyncState;
  syncError: string | null;
  lastSyncedAt: number | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutGoogle: () => Promise<void>;
  setSyncStatus: (state: CloudSyncState, errorMsg?: string | null) => void;
  clearAuthError: () => void;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<CloudSyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setSyncState('idle');
        setSyncError(null);
      } else {
        setUnauthorizedDomain(null);
      }
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setUnauthorizedDomain(null);
    setIsSigningIn(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('ยกเลิกการเข้าสู่ระบบด้วย Google');
      } else if (msg.includes('popup-blocked')) {
        setAuthError('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัปแล้วลองใหม่');
      } else if (msg.includes('unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setUnauthorizedDomain(host || null);
        setAuthError(
          `โดเมน "${host}" ยังไม่ได้รับอนุญาตใน Firebase Authentication (auth/unauthorized-domain) กรุณาเพิ่มโดเมนนี้ใน Authorized domains ของโปรเจกต์ ${firebaseProjectInfo.projectId}`
        );
      } else {
        setAuthError(msg);
      }
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    setAuthError(null);
    setUnauthorizedDomain(null);
    await signOut(auth);
    setSyncState('idle');
    setSyncError(null);
    setLastSyncedAt(null);
  }, []);

  const setSyncStatus = useCallback(
    (state: CloudSyncState, errorMsg?: string | null) => {
      setSyncState(state);
      setSyncError(errorMsg ?? null);
      if (state === 'synced') {
        setLastSyncedAt(Date.now());
      }
    },
    []
  );

  const clearAuthError = useCallback(() => {
    setAuthError(null);
    setUnauthorizedDomain(null);
  }, []);

  const value = useMemo<FirebaseContextValue>(
    () => ({
      authReady,
      user,
      projectId: firebaseProjectInfo.projectId,
      firestoreDatabaseId: firebaseProjectInfo.firestoreDatabaseId,
      isSigningIn,
      authError,
      unauthorizedDomain,
      syncState,
      syncError,
      lastSyncedAt,
      signInWithGoogle,
      signOutGoogle,
      setSyncStatus,
      clearAuthError,
    }),
    [
      authReady,
      user,
      isSigningIn,
      authError,
      unauthorizedDomain,
      syncState,
      syncError,
      lastSyncedAt,
      signInWithGoogle,
      signOutGoogle,
      setSyncStatus,
      clearAuthError,
    ]
  );

  return (
    <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
