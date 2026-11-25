import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { evaluatePasswordStrength, generateSecurePassword } from '../lib/crypto';
import {
  DEFAULT_SYSTEM_NAME,
  type AdminRole,
  type PublicAdminSummary,
  type SyncedDeviceInfo,
} from '../types/vault';
import { useFirebase } from './FirebaseProvider';

interface AdminWithMeta extends PublicAdminSummary {
  createdAt: number;
  updatedAt: number;
}

interface SystemSettingsViewProps {
  systemName: string;
  admins: AdminWithMeta[];
  activeAdminId: string | null;
  onUpdateSystemName: (nextName: string) => Promise<void>;
  onAddAdmin: (input: {
    username: string;
    displayName: string;
    role: AdminRole;
    password: string;
  }) => Promise<void>;
  onUpdateAdmin: (input: {
    id: string;
    username: string;
    displayName: string;
    role: AdminRole;
    newPassword?: string;
  }) => Promise<void>;
  onDeleteAdmin: (id: string) => Promise<void>;
  onOpenSecurityModal: () => void;
  onSyncNow: () => Promise<void>;
  connectedDevices: SyncedDeviceInfo[];
  currentDeviceId: string;
  onRemoveDevice: (deviceId: string) => Promise<void>;
}

export function SystemSettingsView({
  systemName,
  admins,
  activeAdminId,
  onUpdateSystemName,
  onAddAdmin,
  onUpdateAdmin,
  onDeleteAdmin,
  onOpenSecurityModal,
  onSyncNow,
  connectedDevices,
  currentDeviceId,
  onRemoveDevice,
}: SystemSettingsViewProps) {
  const {
    user,
    projectId,
    isSigningIn,
    authError,
    syncState,
    syncError,
    lastSyncedAt,
    signInWithGoogle,
    signOutGoogle,
  } = useFirebase();
  const [manualSyncNotice, setManualSyncNotice] = useState<string | null>(null);
  // System Name Form State
  const [nameInput, setNameInput] = useState(systemName);
  const [savingName, setSavingName] = useState(false);
  const [nameNotice, setNameNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Admin Modal/Drawer Form State
  const [adminFormOpen, setAdminFormOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminWithMeta | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [savingAdmin, setSavingAdmin] = useState(false);

  const [pendingDeleteAdmin, setPendingDeleteAdmin] = useState<AdminWithMeta | null>(null);
  const [adminActionNotice, setAdminActionNotice] = useState<string | null>(null);

  const strength = evaluatePasswordStrength(password);

  async function handleSaveSystemName(e: React.FormEvent) {
    e.preventDefault();
    setNameNotice(null);
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameNotice({ type: 'error', text: 'กรุณาระบุชื่อระบบ (ห้ามเว้นว่าง)' });
      return;
    }
    if (trimmed.length > 40) {
      setNameNotice({ type: 'error', text: 'ชื่อระบบต้องไม่เกิน 40 ตัวอักษร' });
      return;
    }
    setSavingName(true);
    try {
      await onUpdateSystemName(trimmed);
      setNameInput(trimmed);
      setNameNotice({
        type: 'success',
        text: `เปลี่ยนชื่อระบบเป็น "${trimmed}" เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setNameNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'ไม่สามารถบันทึกชื่อระบบได้',
      });
    } finally {
      setSavingName(false);
    }
  }

  function openAddAdminForm() {
    setEditingAdmin(null);
    setUsername('');
    setDisplayName('');
    setRole('admin');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setAdminError(null);
    setAdminFormOpen(true);
  }

  function openEditAdminForm(admin: AdminWithMeta) {
    setEditingAdmin(admin);
    setUsername(admin.username);
    setDisplayName(admin.displayName);
    setRole(admin.role);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setAdminError(null);
    setAdminFormOpen(true);
  }

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);

    const cleanUsername = username.trim();
    const cleanDisplayName = displayName.trim() || cleanUsername;

    if (!cleanUsername) {
      setAdminError('กรุณาระบุชื่อผู้ใช้ Admin (Username)');
      return;
    }
    if (cleanUsername.length < 2 || cleanUsername.length > 32) {
      setAdminError('ชื่อผู้ใช้ควรมีความยาว 2–32 ตัวอักษร');
      return;
    }

    const duplicate = admins.some(
      (a) =>
        a.username.toLowerCase() === cleanUsername.toLowerCase() &&
        a.id !== editingAdmin?.id
    );
    if (duplicate) {
      setAdminError(`ชื่อผู้ใช้ "${cleanUsername}" ถูกใช้งานแล้ว`);
      return;
    }

    if (!editingAdmin) {
      if (password.length < 8) {
        setAdminError('รหัสผ่านสำหรับ Admin ใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
        return;
      }
      if (password !== confirmPassword) {
        setAdminError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        return;
      }
    } else if (password.length > 0 || confirmPassword.length > 0) {
      if (password.length < 8) {
        setAdminError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
        return;
      }
      if (password !== confirmPassword) {
        setAdminError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
        return;
      }
    }

    setSavingAdmin(true);
    try {
      if (editingAdmin) {
        await onUpdateAdmin({
          id: editingAdmin.id,
          username: cleanUsername,
          displayName: cleanDisplayName,
          role,
          newPassword: password.length > 0 ? password : undefined,
        });
        setAdminActionNotice(`อัปเดตข้อมูลผู้ดูแลระบบ "${cleanDisplayName}" แล้ว`);
      } else {
        await onAddAdmin({
          username: cleanUsername,
          displayName: cleanDisplayName,
          role,
          password,
        });
        setAdminActionNotice(`เพิ่มผู้ดูแลระบบ "${cleanDisplayName}" เรียบร้อยแล้ว`);
      }
      setAdminFormOpen(false);
      setEditingAdmin(null);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกข้อมูล Admin ได้');
    } finally {
      setSavingAdmin(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Section 1: System Branding / Rename */}
      <section className="relative overflow-hidden bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-500"
        />

        <div className="flex flex-wrap items-start justify-between gap-4 pt-1">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-blue-600/20">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                ชื่อระบบและแบรนด์หัวเว็บ
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                เปลี่ยนชื่อที่แสดงบนแถบเมนูด้านบนและชื่อแท็บเบราว์เซอร์แทน "{DEFAULT_SYSTEM_NAME}"
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenSecurityModal}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 cursor-pointer whitespace-nowrap transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>ตั้งค่าการล็อกอัตโนมัติ & สำรองข้อมูล</span>
          </button>
        </div>

        <form onSubmit={handleSaveSystemName} className="mt-5 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="system-brand-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                ชื่อระบบที่แสดง (1–40 ตัวอักษร)
              </label>
              <input
                id="system-brand-name"
                type="text"
                maxLength={40}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={DEFAULT_SYSTEM_NAME}
                className="w-full h-11 sm:h-10 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setNameInput(DEFAULT_SYSTEM_NAME);
                  setNameNotice(null);
                }}
                className="h-11 sm:h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>คืนค่าเริ่มต้น</span>
              </button>

              <button
                type="submit"
                disabled={savingName}
                className="h-11 sm:h-10 px-4 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-blue-600/20 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingName ? 'กำลังบันทึก...' : 'บันทึกชื่อระบบ'}</span>
              </button>
            </div>
          </div>

          {nameNotice && (
            <div
              role={nameNotice.type === 'error' ? 'alert' : 'status'}
              className={`flex items-center gap-2 text-xs font-medium ${
                nameNotice.type === 'error'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {nameNotice.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{nameNotice.text}</span>
            </div>
          )}
        </form>
      </section>

      {/* Section 2: Admin Account & Password Management */}
      <section className="relative overflow-hidden bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-emerald-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-violet-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                บัญชีผู้ดูแลระบบ (Admin) และรหัสผ่าน
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                เพิ่ม แก้ไขชื่อ หรือเปลี่ยนรหัสผ่านของ Admin แต่ละคนได้อิสระ โดยแต่ละบัญชีจะเข้ารหัสกุญแจด้วย PBKDF2-SHA256
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openAddAdminForm}
            className="inline-flex items-center gap-1.5 h-10 sm:h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm shadow-violet-600/20 cursor-pointer whitespace-nowrap transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>เพิ่ม Admin</span>
          </button>
        </div>

        {adminActionNotice && (
          <div
            role="status"
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{adminActionNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAdminActionNotice(null)}
              aria-label="ปิดการแจ้งเตือน"
              className="text-emerald-600 dark:text-emerald-400 hover:opacity-75 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="mt-5 divide-y divide-slate-200/80 dark:divide-slate-800 border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden">
          {admins.map((admin) => {
            const isCurrent = admin.id === activeAdminId;
            const canDelete = admins.length > 1 && !isCurrent;

            return (
              <div
                key={admin.id}
                className="p-4 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white shrink-0 ${
                      admin.role === 'super_admin'
                        ? 'bg-gradient-to-br from-indigo-500 to-violet-600'
                        : 'bg-gradient-to-br from-sky-500 to-cyan-600'
                    }`}
                  >
                    {(admin.displayName.charAt(0) || admin.username.charAt(0) || 'A').toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {admin.displayName}
                      </span>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        @{admin.username}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      <span
                        className={
                          admin.role === 'super_admin'
                            ? 'font-medium text-violet-600 dark:text-violet-400'
                            : 'font-medium text-sky-600 dark:text-sky-400'
                        }
                      >
                        {admin.role === 'super_admin' ? 'ผู้ดูแลหลัก' : 'ผู้ดูแลระบบ'}
                      </span>
                      {isCurrent && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            กำลังใช้งานเซสชันนี้
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        อัปเดต {new Date(admin.updatedAt).toLocaleDateString('th-TH')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => openEditAdminForm(admin)}
                    className="inline-flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>แก้ไขข้อมูล / รหัสผ่าน</span>
                  </button>

                  <button
                    type="button"
                    disabled={!canDelete}
                    onClick={() => setPendingDeleteAdmin(admin)}
                    title={
                      isCurrent
                        ? 'ไม่สามารถลบบัญชี Admin ที่กำลังล็อกอินอยู่ได้'
                        : admins.length <= 1
                          ? 'ต้องมี Admin อย่างน้อย 1 บัญชี'
                          : `ลบบัญชี ${admin.username}`
                    }
                    className="inline-flex items-center gap-1 h-10 sm:h-8 px-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ลบ</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 3: Firebase Cloud Sync */}
      <section className="relative overflow-hidden bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-blue-600 to-emerald-500"
        />

        <div className="flex flex-wrap items-start justify-between gap-4 pt-1">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-sky-500/20">
              {user ? <Cloud className="w-5 h-5" /> : <CloudOff className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                ซิงก์ข้อมูลบนคลาวด์ Firebase ({projectId})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                เชื่อมต่อบัญชี Google เพื่อสำรองชื่อระบบ รายการแอป และคลังรหัสที่เข้ารหัสแล้วข้ามอุปกรณ์
              </p>
            </div>
          </div>

          {user ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={syncState === 'syncing'}
                onClick={async () => {
                  setManualSyncNotice(null);
                  await onSyncNow();
                  setManualSyncNotice('ซิงก์ข้อมูลขึ้น Firebase เรียบร้อยแล้ว');
                }}
                className="inline-flex items-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-lg bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-sky-600/20 cursor-pointer whitespace-nowrap transition-all"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncState === 'syncing' ? 'animate-spin' : ''}`}
                />
                <span>
                  {syncState === 'syncing' ? 'กำลังซิงก์...' : 'ซิงก์ข้อมูลทันที'}
                </span>
              </button>

              <button
                type="button"
                onClick={signOutGoogle}
                className="inline-flex items-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>ออกจากบัญชี Google</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={signInWithGoogle}
              className="inline-flex items-center gap-1.5 h-10 sm:h-9 px-4 rounded-lg bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-sky-600/20 cursor-pointer whitespace-nowrap transition-all"
            >
              <Cloud className="w-4 h-4" />
              <span>
                {isSigningIn ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อด้วย Google'}
              </span>
            </button>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-4 text-xs space-y-2">
          {user ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {user.displayName || 'บัญชี Google'} ({user.email})
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  โปรเจกต์: <span className="font-mono">{projectId}</span>
                  {lastSyncedAt && (
                    <>
                      {' · '}อัปเดตล่าสุด {new Date(lastSyncedAt).toLocaleString('th-TH')}
                    </>
                  )}
                </p>
              </div>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                เชื่อมต่อคลาวด์แล้ว
              </span>
            </div>
          ) : (
            <p className="text-slate-600 dark:text-slate-400">
              ขณะนี้แอปบันทึกข้อมูลในเครื่อง (Local Storage) — เข้าสู่ระบบด้วย Google เพื่อซิงก์ข้อมูลไปยัง Firestore ของโปรเจกต์ <span className="font-mono font-semibold">{projectId}</span>
            </p>
          )}

          {(authError || syncError) && (
            <div className="flex items-start gap-2 text-rose-600 dark:text-rose-400 pt-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError || syncError}</span>
            </div>
          )}

          {manualSyncNotice && !syncError && (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 pt-1">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{manualSyncNotice}</span>
            </div>
          )}
        </div>

        {user && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span>อุปกรณ์ที่เชื่อมต่อแบบ Real-time ({connectedDevices.length})</span>
              <span className="font-normal text-slate-500 dark:text-slate-400">
                ซิงก์ทุกการเปลี่ยนแปลงอัตโนมัติ
              </span>
            </div>

            {connectedDevices.length > 0 && (
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800 border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden">
                {connectedDevices.map((dev) => {
                  const isCurrent = dev.id === currentDeviceId;
                  return (
                    <div
                      key={dev.id}
                      className="px-3.5 py-2.5 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                          {dev.platform === 'mobile' ? (
                            <Smartphone className="w-4 h-4" />
                          ) : dev.platform === 'tablet' ? (
                            <Tablet className="w-4 h-4" />
                          ) : (
                            <Monitor className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {dev.deviceName}
                            {isCurrent && (
                              <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                                · อุปกรณ์นี้
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 tabular-nums">
                            เชื่อมต่อเมื่อ {new Date(dev.updatedAt).toLocaleString('th-TH')}
                          </div>
                        </div>
                      </div>

                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => onRemoveDevice(dev.id)}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                        >
                          นำออก
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Add / Edit Admin Modal */}
      {adminFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-form-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl sm:my-auto overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-r from-violet-50/80 via-indigo-50/40 to-white dark:from-violet-950/30 dark:via-slate-900 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shrink-0">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="admin-form-title"
                    className="text-base font-bold text-slate-900 dark:text-slate-100 truncate"
                  >
                    {editingAdmin
                      ? `แก้ไขผู้ดูแล: ${editingAdmin.displayName}`
                      : 'เพิ่มผู้ดูแลระบบ (Admin) ใหม่'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    เข้ารหัสกุญแจส่วนตัวด้วย PBKDF2-SHA256 + AES-256-GCM
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAdminFormOpen(false)}
                aria-label="ปิดหน้าต่าง"
                className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/80 dark:hover:bg-slate-800 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleAdminSubmit}
              className="p-4 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 max-h-[82dvh] sm:max-h-[78dvh] overflow-y-auto"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ชื่อผู้ใช้ (Username)
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="เช่น admin2, somchai"
                    autoComplete="off"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ชื่อที่แสดง (Display Name)
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="เช่น ผู้ดูแลฝ่ายไอที"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  บทบาทสิทธิ์ (Role)
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as AdminRole)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="super_admin">ผู้ดูแลหลัก (Super Admin)</option>
                  <option value="admin">ผู้ดูแลระบบ (Admin)</option>
                </select>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {editingAdmin
                      ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างหากใช้รหัสเดิม)'
                      : 'กำหนดรหัสผ่าน (8 ตัวอักษรขึ้นไป)'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const generated = generateSecurePassword({ length: 16 });
                      setPassword(generated);
                      setConfirmPassword(generated);
                      setShowPassword(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>สุ่มรหัสปลอดภัย</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={
                      editingAdmin
                        ? 'เว้นว่างเพื่อใช้รหัสผ่านเดิม...'
                        : 'กรอกรหัสผ่านอย่างน้อย 8 ตัวอักษร...'
                    }
                    className="w-full h-10 pl-3 pr-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {password.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">ความแข็งแรง:</span>
                      <span
                        className={`font-semibold ${
                          strength.tone === 'strong'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : strength.tone === 'good'
                              ? 'text-blue-600 dark:text-blue-400'
                              : strength.tone === 'fair'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {strength.label}
                      </span>
                    </div>

                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="ยืนยันรหัสผ่านอีกครั้ง..."
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              {adminError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{adminError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdminFormOpen(false)}
                  className="h-10 sm:h-9 px-4 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingAdmin}
                  className="h-10 sm:h-9 px-5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-violet-600/20 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {savingAdmin
                      ? 'กำลังเข้ารหัส...'
                      : editingAdmin
                        ? 'บันทึกข้อมูล Admin'
                        : 'สร้างบัญชี Admin'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Admin Confirm Dialog */}
      {pendingDeleteAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              ยืนยันลบบัญชี "{pendingDeleteAdmin.displayName}"?
            </h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              ผู้ดูแล @{pendingDeleteAdmin.username} จะไม่สามารถใช้รหัสผ่านเพื่อปลดล็อกคลังได้อีกต่อไป
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteAdmin(null)}
                className="h-11 sm:h-9 px-4 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetId = pendingDeleteAdmin.id;
                  setPendingDeleteAdmin(null);
                  await onDeleteAdmin(targetId);
                  setAdminActionNotice('ลบบัญชีผู้ดูแลระบบเรียบร้อยแล้ว');
                }}
                className="h-11 sm:h-9 px-4 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer whitespace-nowrap"
              >
                ลบบัญชีถาวร
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
