import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  KeyRound,
  ShieldCheck,
  X,
} from 'lucide-react';
import { evaluatePasswordStrength } from '../lib/crypto';
import type { EncryptedVaultEnvelope, VaultSettings } from '../types/vault';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  settings: VaultSettings;
  envelope: EncryptedVaultEnvelope | null;
  appCount: number;
  onClose: () => void;
  onUpdateSettings: (next: Partial<VaultSettings>) => Promise<void>;
  onChangeMasterPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onExportBackup: () => void;
}

export function SecuritySettingsModal({
  isOpen,
  settings,
  envelope,
  appCount,
  onClose,
  onUpdateSettings,
  onChangeMasterPassword,
  onExportBackup,
}: SecuritySettingsModalProps) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [isChangingPw, setIsChangingPw] = useState(false);

  if (!isOpen) return null;

  const strength = evaluatePasswordStrength(newPw);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPw || !newPw) {
      setPwError('กรุณากรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่');
      return;
    }
    if (newPw.length < 8) {
      setPwError('รหัสผ่านใหม่ควรมีความยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (newPw !== confirmNewPw) {
      setPwError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }

    setIsChangingPw(true);
    try {
      await onChangeMasterPassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setConfirmNewPw('');
      setPwSuccess('เปลี่ยน Master Password และเข้ารหัสคลังใหม่เรียบร้อยแล้ว');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
    } finally {
      setIsChangingPw(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="security-settings-title"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl sm:my-auto overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-r from-emerald-50/70 via-sky-50/40 to-white dark:from-emerald-950/25 dark:via-slate-900 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h2
              id="security-settings-title"
              className="text-base font-bold text-slate-900 dark:text-slate-100 truncate"
            >
              ตั้งค่าความปลอดภัยและการสำรองข้อมูล
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/80 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-6 max-h-[82dvh] sm:max-h-[78dvh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                ล็อกอัตโนมัติเมื่อไม่มีการใช้งาน
              </label>
              <select
                value={settings.autoLockMinutes}
                onChange={(e) =>
                  onUpdateSettings({ autoLockMinutes: Number(e.target.value) })
                }
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value={1}>1 นาที</option>
                <option value={5}>5 นาที (แนะนำ)</option>
                <option value={15}>15 นาที</option>
                <option value={30}>30 นาที</option>
                <option value={0}>ปิดการล็อกอัตโนมัติ (ล็อกด้วยตนเอง)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                ล้าง Clipboard อัตโนมัติหลังคัดลอกรหัส
              </label>
              <select
                value={settings.clipboardClearSeconds}
                onChange={(e) =>
                  onUpdateSettings({ clipboardClearSeconds: Number(e.target.value) })
                }
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value={15}>15 วินาที</option>
                <option value={20}>20 วินาที (แนะนำ)</option>
                <option value={30}>30 วินาที</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              สถาปัตยกรรมการเข้ารหัสคลังข้อมูลปัจจุบัน
            </h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Symmetric Cipher</dt>
                <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">
                  {envelope?.cipher ?? 'AES-256-GCM'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Key Derivation</dt>
                <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">
                  {envelope?.kdf ?? 'PBKDF2-SHA256'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">KDF Iterations</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {(envelope?.iterations ?? 600000).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">รายการที่เข้ารหัส</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {appCount} แอป
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                สำรองข้อมูลแบบเข้ารหัส (Encrypted Backup)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ส่งออกไฟล์ .vault.json ที่ยังคงเข้ารหัส AES-256-GCM เพื่อย้ายเครื่องหรือเก็บสำรอง
              </p>
            </div>
            <button
              type="button"
              onClick={onExportBackup}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>ส่งออก .vault.json</span>
            </button>
          </div>

          <hr className="border-slate-200 dark:border-slate-800" />

          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                เปลี่ยน Master Password
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="รหัสผ่านหลักเดิม"
                autoComplete="current-password"
                className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="รหัสผ่านหลักใหม่ (8+ ตัว)"
                autoComplete="new-password"
                className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <input
                type="password"
                value={confirmNewPw}
                onChange={(e) => setConfirmNewPw(e.target.value)}
                placeholder="ยืนยันรหัสผ่านใหม่"
                autoComplete="new-password"
                className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {newPw.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ความแข็งแรงรหัสผ่านใหม่:{' '}
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {strength.label}
                </span>
              </p>
            )}

            {pwError && (
              <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{pwError}</span>
              </div>
            )}

            {pwSuccess && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pwSuccess}</span>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isChangingPw}
                className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-blue-600/20 cursor-pointer whitespace-nowrap transition-all"
              >
                {isChangingPw ? 'กำลังเข้ารหัสคลังใหม่...' : 'อัปเดต Master Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
