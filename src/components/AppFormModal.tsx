import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { evaluatePasswordStrength, generateSecurePassword } from '../lib/crypto';
import { isSafeImageUrl, rasterizeUploadedLogo, validateTargetUrl } from '../lib/urlSafety';
import type { AppItem, LogoType } from '../types/vault';
import { AppLogo, PRESET_ICONS, PRESET_TONES } from './AppLogo';

interface AppFormModalProps {
  isOpen: boolean;
  editingApp: AppItem | null;
  categories: string[];
  onClose: () => void;
  onSave: (data: {
    name: string;
    target_url: string;
    logo_type: LogoType;
    logo_value: string;
    category: string;
    is_favorite: boolean;
    username: string;
    password: string;
    notes: string;
  }) => Promise<void>;
}

export function AppFormModal({
  isOpen,
  editingApp,
  categories,
  onClose,
  onSave,
}: AppFormModalProps) {
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [logoType, setLogoType] = useState<LogoType>('favicon');
  const [logoValue, setLogoValue] = useState('');
  const [presetIconKey, setPresetIconKey] = useState('globe');
  const [presetToneKey, setPresetToneKey] = useState('cobalt');
  const [category, setCategory] = useState(categories[0] ?? 'งาน');
  const [customCategory, setCustomCategory] = useState('');
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState('');
  const [genLength, setGenLength] = useState(18);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    setUploadError(null);
    setShowPassword(false);

    if (editingApp) {
      setName(editingApp.name);
      setTargetUrl(editingApp.target_url);
      setLogoType(editingApp.logo_type);
      setLogoValue(editingApp.logo_value);
      if (editingApp.logo_type === 'preset_icon') {
        const [iconK, toneK] = (editingApp.logo_value || 'globe:cobalt').split(':');
        setPresetIconKey(iconK || 'globe');
        setPresetToneKey(toneK || 'cobalt');
      } else {
        setPresetIconKey('globe');
        setPresetToneKey('cobalt');
      }
      setCategory(editingApp.category);
      setUseCustomCategory(false);
      setCustomCategory('');
      setIsFavorite(editingApp.is_favorite);
      setUsername(editingApp.credentials.username);
      setPassword(editingApp.credentials.password);
      setNotes(editingApp.credentials.notes);
    } else {
      setName('');
      setTargetUrl('');
      setLogoType('favicon');
      setLogoValue('');
      setPresetIconKey('globe');
      setPresetToneKey('cobalt');
      setCategory(categories[0] ?? 'งาน');
      setUseCustomCategory(false);
      setCustomCategory('');
      setIsFavorite(false);
      setUsername('');
      setPassword('');
      setNotes('');
    }
  }, [isOpen, editingApp, categories]);

  if (!isOpen) return null;

  const urlCheck = validateTargetUrl(targetUrl);
  const effectiveLogoValue =
    logoType === 'preset_icon'
      ? `${presetIconKey}:${presetToneKey}`
      : logoType === 'favicon'
        ? urlCheck.normalizedUrl || targetUrl
        : logoValue;

  const strength = evaluatePasswordStrength(password);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const dataUrl = await rasterizeUploadedLogo(file);
      setLogoType('upload');
      setLogoValue(dataUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'อัปโหลดรูปไม่สำเร็จ');
    }
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('กรุณาระบุชื่อแอปพลิเคชัน');
      return;
    }

    if (!urlCheck.valid) {
      setFormError(urlCheck.error || 'ลิงก์ปลายทางไม่ถูกต้อง');
      return;
    }

    if (logoType === 'url' && logoValue.trim() && !isSafeImageUrl(logoValue)) {
      setFormError('URL ของรูปโลโก้ต้องขึ้นต้นด้วย https:// หรือ http:// เท่านั้น');
      return;
    }

    const finalCategory = useCustomCategory
      ? customCategory.trim() || 'ทั่วไป'
      : category;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        target_url: urlCheck.normalizedUrl,
        logo_type: logoType,
        logo_value: effectiveLogoValue,
        category: finalCategory,
        is_favorite: isFavorite,
        username: username.trim(),
        password,
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกข้อมูลได้');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-form-title"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl sm:my-auto overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-r from-blue-50/80 via-indigo-50/40 to-white dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo
              name={name || 'A'}
              logoType={logoType}
              logoValue={effectiveLogoValue}
              targetUrl={urlCheck.normalizedUrl || targetUrl}
              size="md"
            />
            <div className="min-w-0">
              <h2
                id="app-form-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                {editingApp ? `แก้ไข: ${editingApp.name}` : 'เพิ่มแอปใหม่เข้าคลัง'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ข้อมูลรหัสผ่านจะถูกเข้ารหัสด้วย AES-256-GCM ก่อนบันทึก
              </p>
            </div>
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

        <form
          onSubmit={handleSubmit}
          className="p-4 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-6 max-h-[82dvh] sm:max-h-[78dvh] overflow-y-auto"
        >
          {/* Identity & Destination */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  ชื่อแอปพลิเคชัน
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น GitHub, Figma, KBank Biz"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    หมวดหมู่
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseCustomCategory((v) => !v)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    {useCustomCategory ? 'เลือกจากรายการ' : '+ สร้างหมวดหมู่ใหม่'}
                  </button>
                </div>
                {useCustomCategory ? (
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="ระบุชื่อหมวดหมู่ใหม่..."
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                ) : (
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  ลิงก์ปลายทาง (URL หรือ Desktop Deep Link)
                </label>
                {targetUrl.trim() && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      urlCheck.valid
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {urlCheck.valid ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {urlCheck.kind === 'deeplink'
                            ? `Deep Link (${urlCheck.displayHost})`
                            : `เว็บปลอดภัย (${urlCheck.displayHost})`}
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{urlCheck.error}</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://app.example.com หรือ slack://open, vscode://..."
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Logo Picker */}
            <div className="pt-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                รูปแบบโลโก้ (Logo / Icon)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg mb-3">
                {(
                  [
                    { id: 'favicon', label: 'ดึง Favicon อัตโนมัติ' },
                    { id: 'preset_icon', label: 'ไอคอนสำเร็จรูป' },
                    { id: 'upload', label: 'อัปโหลดรูป' },
                    { id: 'url', label: 'ลิงก์รูปภาพ URL' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setLogoType(mode.id)}
                    className={`px-2.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                      logoType === mode.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {logoType === 'favicon' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ระบบจะดึงไอคอนเว็บไซต์จากโดเมนของลิงก์ปลายทางโดยอัตโนมัติ (มีตัวอักษรย่อสำรองหากเป็น Deep Link หรือโหลดไม่สำเร็จ)
                </p>
              )}

              {logoType === 'url' && (
                <input
                  type="url"
                  value={logoValue}
                  onChange={(e) => setLogoValue(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}

              {logoType === 'upload' && (
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="w-4 h-4" />
                    <span>เลือกไฟล์ PNG / JPG / WebP</span>
                  </button>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    ย่อขนาดและแปลงเป็น PNG 128×128 ปลอดภัยในเครื่อง
                  </span>
                  {uploadError && (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      {uploadError}
                    </span>
                  )}
                </div>
              )}

              {logoType === 'preset_icon' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
                    {PRESET_ICONS.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        title={label}
                        onClick={() => setPresetIconKey(key)}
                        className={`h-9 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                          presetIconKey === key
                            ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">โทนสี:</span>
                    {PRESET_TONES.map((tone) => (
                      <button
                        key={tone.key}
                        type="button"
                        onClick={() => setPresetToneKey(tone.key)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                          presetToneKey === tone.key
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 shadow-2xs'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-3 h-3 rounded-sm ${tone.swatchClass}`}
                        />
                        <span>{tone.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <hr className="border-slate-200 dark:border-slate-800" />

          {/* Encrypted Credentials */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                ข้อมูลเข้าสู่ระบบ (เข้ารหัสใน Vault)
              </h3>
              <button
                type="button"
                onClick={() => setIsFavorite((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                  isFavorite
                    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                <span>{isFavorite ? 'ปักหมุดรายการโปรดแล้ว' : 'ปักหมุดรายการโปรด'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  ชื่อผู้ใช้ / อีเมล (Username / Email)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="user@company.com"
                  autoComplete="off"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    รหัสผ่าน (Password)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setPassword(generateSecurePassword({ length: genLength }));
                      setShowPassword(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>สุ่มรหัสปลอดภัย ({genLength} ตัว)</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="เว้นว่างได้หากไม่ต้องการเก็บ"
                    autoComplete="new-password"
                    className="w-full h-10 pl-3 pr-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
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
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 dark:text-slate-400">ความแข็งแรง:</span>
                <span
                  className={`font-semibold ${
                    strength.tone === 'strong'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : strength.tone === 'good'
                        ? 'text-blue-600 dark:text-blue-400'
                        : strength.tone === 'fair'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {strength.label}
                </span>
              </div>

              <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <span>ความยาวตัวสุ่ม:</span>
                <input
                  type="range"
                  min={12}
                  max={32}
                  value={genLength}
                  onChange={(e) => setGenLength(Number(e.target.value))}
                  className="w-24 accent-blue-600"
                />
                <span className="font-mono tabular-nums w-5 text-right">{genLength}</span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                หมายเหตุเพิ่มเติม / PIN / Recovery Hint
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="เช่น PIN 6 หลัก, วิธียืนยันตัวตน 2FA หรือคำใบ้บัญชี"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white text-xs font-semibold shadow-sm shadow-blue-600/20 cursor-pointer whitespace-nowrap transition-all"
            >
              {isSaving
                ? 'กำลังเข้ารหัส...'
                : editingApp
                  ? 'บันทึกการเปลี่ยนแปลง'
                  : 'เพิ่มแอปและเข้ารหัส'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
