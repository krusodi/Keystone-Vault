import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { evaluatePasswordStrength } from '../lib/crypto';
import { getEnvelopeAdmins, isValidEnvelope } from '../lib/storage';
import type { EncryptedVaultEnvelope, PublicAdminSummary } from '../types/vault';
import { useFirebase } from './FirebaseProvider';

interface VaultGatePanelProps {
  hasExistingVault: boolean;
  admins: PublicAdminSummary[];
  targetMenuTitle: string;
  onCreateVault: (params: {
    username: string;
    displayName: string;
    masterPassword: string;
  }) => Promise<void>;
  onUnlockVault: (masterPassword: string, adminId?: string) => Promise<void>;
  onImportEnvelope: (
    envelope: EncryptedVaultEnvelope,
    masterPassword: string,
    adminId?: string
  ) => Promise<void>;
  onResetVault: () => void;
  onBackToHome: () => void;
  lastUpdatedAt?: number;
}

export function VaultGatePanel({
  hasExistingVault,
  admins,
  targetMenuTitle,
  onCreateVault,
  onUnlockVault,
  onImportEnvelope,
  onResetVault,
  onBackToHome,
  lastUpdatedAt,
}: VaultGatePanelProps) {
  const {
    user,
    projectId,
    isSigningIn,
    authError,
    unauthorizedDomain,
    signInWithGoogle,
  } = useFirebase();
  const [setupUsername, setSetupUsername] = useState('admin');
  const [setupDisplayName, setSetupDisplayName] = useState('ผู้ดูแลระบบหลัก');
  const [selectedAdminId, setSelectedAdminId] = useState<string>(admins[0]?.id ?? '');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingImportEnvelope, setPendingImportEnvelope] =
    useState<EncryptedVaultEnvelope | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const strength = evaluatePasswordStrength(masterPassword);

  const isImportMode = pendingImportEnvelope !== null;
  const isSetupMode = !hasExistingVault && !isImportMode;
  const displayedAdmins = isImportMode
    ? getEnvelopeAdmins(pendingImportEnvelope)
    : admins;

  useEffect(() => {
    if (displayedAdmins.length === 0) {
      setSelectedAdminId('');
      return;
    }
    if (!displayedAdmins.some((a) => a.id === selectedAdminId)) {
      setSelectedAdminId(displayedAdmins[0].id);
    }
  }, [displayedAdmins, selectedAdminId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!masterPassword) {
      setErrorMsg('กรุณากรอกรหัสผ่าน');
      return;
    }

    if (isSetupMode) {
      if (!setupUsername.trim()) {
        setErrorMsg('กรุณาระบุชื่อผู้ใช้ Admin');
        return;
      }
      if (masterPassword.length < 8) {
        setErrorMsg('รหัสผ่านหลักควรมีความยาวอย่างน้อย 8 ตัวอักษร');
        return;
      }
      if (masterPassword !== confirmPassword) {
        setErrorMsg('รหัสผ่านหลักทั้งสองช่องไม่ตรงกัน');
        return;
      }
    }

    setIsProcessing(true);
    try {
      if (isImportMode && pendingImportEnvelope) {
        await onImportEnvelope(
          pendingImportEnvelope,
          masterPassword,
          selectedAdminId || undefined
        );
      } else if (isSetupMode) {
        await onCreateVault({
          username: setupUsername.trim() || 'admin',
          displayName: setupDisplayName.trim() || setupUsername.trim() || 'ผู้ดูแลระบบหลัก',
          masterPassword,
        });
      } else {
        await onUnlockVault(masterPassword, selectedAdminId || undefined);
      }
      setMasterPassword('');
      setConfirmPassword('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถเปิดคลังข้อมูลได้');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!isValidEnvelope(parsed)) {
          setErrorMsg('ไฟล์สำรองไม่ถูกต้องหรือไม่ใช่รูปแบบ Keystone Vault');
          return;
        }
        setPendingImportEnvelope(parsed);
        const importedAdmins = getEnvelopeAdmins(parsed);
        setSelectedAdminId(importedAdmins[0]?.id ?? '');
        setMasterPassword('');
      } catch {
        setErrorMsg('ไม่สามารถอ่านไฟล์ JSON ที่เลือกได้');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="max-w-md mx-auto mt-2 sm:mt-10 bg-white/95 dark:bg-slate-900/95 border border-indigo-100 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-lg shadow-indigo-500/5">
      <div className="flex items-start sm:items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/25">
          {isSetupMode ? (
            <KeyRound className="w-5 h-5" />
          ) : (
            <Lock className="w-5 h-5" />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
            {isImportMode
              ? 'นำเข้าไฟล์สำรองเข้ารหัส'
              : isSetupMode
                ? `ตั้งรหัสผ่าน Admin เพื่อเข้า "${targetMenuTitle}"`
                : `ปลดล็อกเพื่อเข้า "${targetMenuTitle}"`}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            เมนูอื่นนอกจากหน้าหลักต้องยืนยันตัวตนและถอดรหัส AES-256-GCM
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {isSetupMode ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="setup-admin-username"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                ชื่อผู้ใช้ Admin แรก
              </label>
              <input
                id="setup-admin-username"
                type="text"
                value={setupUsername}
                onChange={(e) => setSetupUsername(e.target.value)}
                placeholder="admin"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label
                htmlFor="setup-admin-display"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                ชื่อที่แสดง
              </label>
              <input
                id="setup-admin-display"
                type="text"
                value={setupDisplayName}
                onChange={(e) => setSetupDisplayName(e.target.value)}
                placeholder="ผู้ดูแลระบบหลัก"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        ) : displayedAdmins.length > 1 ? (
          <div>
            <label
              htmlFor="unlock-admin-select"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              เลือกบัญชีผู้ดูแลระบบ (Admin)
            </label>
            <select
              id="unlock-admin-select"
              value={selectedAdminId}
              onChange={(e) => setSelectedAdminId(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {displayedAdmins.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.displayName} (@{admin.username})
                </option>
              ))}
            </select>
          </div>
        ) : displayedAdmins.length === 1 ? (
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
            <span>บัญชีผู้ดูแล:</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {displayedAdmins[0].displayName} (@{displayedAdmins[0].username})
            </span>
          </div>
        ) : null}

        <div>
          <label
            htmlFor="vault-master-password"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            {isSetupMode
              ? 'กำหนดรหัสผ่าน Admin (8 ตัวอักษรขึ้นไป)'
              : isImportMode
                ? 'รหัสผ่านของไฟล์สำรอง'
                : 'รหัสผ่าน (Password)'}
          </label>
          <div className="relative">
            <input
              id="vault-master-password"
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              autoComplete={isSetupMode ? 'new-password' : 'current-password'}
              autoFocus
              placeholder="กรอกรหัสผ่านของคุณ..."
              className="w-full h-11 pl-3.5 pr-11 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {isSetupMode && masterPassword.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((step) => {
                  const active = strength.score >= step;
                  const barColor =
                    strength.tone === 'weak'
                      ? 'bg-red-500'
                      : strength.tone === 'fair'
                        ? 'bg-amber-500'
                        : strength.tone === 'good'
                          ? 'bg-blue-600'
                          : 'bg-emerald-600';
                  return (
                    <div
                      key={step}
                      className={`h-1.5 rounded-full transition-colors ${
                        active ? barColor : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                    />
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ความปลอดภัยรหัสผ่าน:{' '}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {strength.label}
                </span>
              </p>
            </div>
          )}
        </div>

        {isSetupMode && (
          <div>
            <label
              htmlFor="vault-confirm-password"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              ยืนยันรหัสผ่าน
            </label>
            <input
              id="vault-confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="กรอกรหัสผ่านอีกครั้ง..."
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            />
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToHome}
            className="h-11 sm:h-10 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            กลับหน้าหลัก
          </button>
          <button
            type="submit"
            disabled={isProcessing}
            className="flex-1 h-11 sm:h-10 px-4 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-blue-600/25 transition-all cursor-pointer whitespace-nowrap"
          >
            {isProcessing
              ? 'กำลังประมวลผล PBKDF2...'
              : isImportMode
                ? 'ถอดรหัสและนำเข้า Vault'
                : isSetupMode
                  ? 'สร้างบัญชี Admin และเปิดคลัง'
                  : 'ปลดล็อกเข้าใช้งาน'}
          </button>
        </div>
      </form>

      <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span>
            เข้ารหัสข้อมูลบัญชีและรหัสผ่านด้วย PBKDF2 (600,000 รอบ) + AES-256-GCM ฝั่ง Client
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.vault.json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          {isImportMode ? (
            <button
              type="button"
              onClick={() => {
                setPendingImportEnvelope(null);
                setErrorMsg(null);
              }}
              className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 font-medium cursor-pointer"
            >
              ← กลับไปหน้าปลดล็อกเดิม
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 font-medium cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>นำเข้าไฟล์สำรอง (.vault.json)</span>
            </button>
          )}

          {hasExistingVault && !isImportMode && (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium cursor-pointer"
            >
              ล้างคลังรหัสเดิม
            </button>
          )}
        </div>

        {lastUpdatedAt && hasExistingVault && !isImportMode && (
          <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
            เข้ารหัสล่าสุด: {new Date(lastUpdatedAt).toLocaleString('th-TH')}
          </p>
        )}

        {!isImportMode && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
            {user ? (
              <div className="flex items-center justify-between gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                <span className="inline-flex items-center gap-1.5 truncate">
                  <Cloud className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    ซิงก์คลาวด์ {projectId}: {user.email}
                  </span>
                </span>
              </div>
            ) : (
              <button
                type="button"
                disabled={isSigningIn}
                onClick={signInWithGoogle}
                className="w-full h-9 px-3 rounded-lg border border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/60 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>
                  {isSigningIn
                    ? 'กำลังเชื่อมต่อ Firebase...'
                    : `ซิงก์ / กู้คืนคลังจาก Firebase (${projectId})`}
                </span>
              </button>
            )}
            {authError && (
              <div className="space-y-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 p-2.5 text-xs text-rose-700 dark:text-rose-300">
                <p className="leading-relaxed">{authError}</p>
                {unauthorizedDomain && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(unauthorizedDomain)
                      }
                      className="px-2.5 py-1 rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-200 font-mono hover:bg-rose-100/60 cursor-pointer"
                    >
                      คัดลอก: {unauthorizedDomain}
                    </button>
                    <a
                      href={`https://console.firebase.google.com/project/${projectId}/authentication/settings`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                    >
                      เปิด Firebase Authorized domains
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showResetConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              ยืนยันการล้างคลังรหัสผ่าน?
            </h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              ข้อมูลรหัสผ่านที่เข้ารหัสไว้จะถูกลบถาวร (รายการโลโก้และลิงก์ในหน้าหลักจะยังคงอยู่)
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="h-11 sm:h-9 px-4 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  onResetVault();
                }}
                className="h-11 sm:h-9 px-4 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white cursor-pointer whitespace-nowrap"
              >
                ลบคลังรหัสผ่านถาวร
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
