import { useState } from 'react';
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { validateTargetUrl } from '../lib/urlSafety';
import type { AppItem } from '../types/vault';
import { AppLogo } from './AppLogo';

interface AppDetailModalProps {
  app: AppItem | null;
  onClose: () => void;
  onEdit: (app: AppItem) => void;
  onDelete: (id: string) => void;
  onCopyUsername: (username: string) => void;
  onCopyPassword: (password: string) => void;
  onLaunch: (app: AppItem) => void;
}

export function AppDetailModal({
  app,
  onClose,
  onEdit,
  onDelete,
  onCopyUsername,
  onCopyPassword,
  onLaunch,
}: AppDetailModalProps) {
  const [revealPassword, setRevealPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!app) return null;

  const urlCheck = validateTargetUrl(app.target_url);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-detail-title"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-r from-blue-50/80 via-indigo-50/40 to-white dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo
              name={app.name}
              logoType={app.logo_type}
              logoValue={app.logo_value}
              targetUrl={app.target_url}
              size="md"
            />
            <div className="min-w-0">
              <h2
                id="app-detail-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                {app.name}
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span>{app.category}</span>
                <span aria-hidden="true">·</span>
                <span>{urlCheck.kind === 'deeplink' ? 'Desktop Deep Link' : 'Web App'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดรายละเอียด"
            className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              ลิงก์ปลายทาง
            </span>
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">
                {app.target_url}
              </span>
              {urlCheck.valid && (
                <a
                  href={urlCheck.normalizedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onLaunch(app)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0 whitespace-nowrap"
                >
                  <span>เปิดแอป</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              ชื่อผู้ใช้ / อีเมล
            </span>
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-sm text-slate-900 dark:text-slate-100 truncate">
                {app.credentials.username || '— ไม่ได้ระบุ —'}
              </span>
              {app.credentials.username && (
                <button
                  type="button"
                  onClick={() => onCopyUsername(app.credentials.username)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>คัดลอก</span>
                </button>
              )}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              รหัสผ่าน (ถอดรหัสในหน่วยความจำ)
            </span>
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-sm font-mono text-slate-900 dark:text-slate-100 truncate">
                {app.credentials.password
                  ? revealPassword
                    ? app.credentials.password
                    : '••••••••••••••••'
                  : '— ไม่ได้บันทึกรหัสผ่าน —'}
              </span>
              {app.credentials.password && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRevealPassword((v) => !v)}
                    aria-label={revealPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {revealPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopyPassword(app.credentials.password)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-2xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>คัดลอก</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {app.credentials.notes && (
            <div>
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                หมายเหตุ / PIN / 2FA
              </span>
              <p className="px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                {app.credentials.notes}
              </p>
            </div>
          )}

          <div className="text-xs text-slate-400 dark:text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>อัปเดตล่าสุด: {new Date(app.updatedAt).toLocaleString('th-TH')}</span>
            {app.lastUsedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>เปิดใช้งานล่าสุด: {new Date(app.lastUsedAt).toLocaleString('th-TH')}</span>
              </>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                ยืนยันลบแอปนี้?
              </span>
              <button
                type="button"
                onClick={() => {
                  onDelete(app.id);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                ลบถาวร
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                ไม่ลบ
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ลบรายการ</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onClose();
              onEdit(app);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>แก้ไขข้อมูล</span>
          </button>
        </div>
      </div>
    </div>
  );
}
