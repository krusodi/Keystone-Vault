import { useEffect, useState } from 'react';
import {
  Briefcase,
  Cloud,
  Code2,
  Database,
  Folder,
  Globe,
  Mail,
  MessageSquare,
  Palette,
  ShieldCheck,
  Terminal,
  Wallet,
} from 'lucide-react';
import { getMonogramGradient } from '../lib/categoryTheme';
import { getFaviconUrl, isSafeImageUrl } from '../lib/urlSafety';
import type { LogoType, PresetIconKey } from '../types/vault';

interface AppLogoProps {
  name: string;
  logoType: LogoType;
  logoValue: string;
  targetUrl: string;
  size?: 'sm' | 'md' | 'lg';
}

export const PRESET_ICONS: Array<{
  key: PresetIconKey;
  label: string;
  Icon: typeof Globe;
}> = [
  { key: 'globe', label: 'เว็บแอป', Icon: Globe },
  { key: 'code', label: 'โค้ด/IDE', Icon: Code2 },
  { key: 'briefcase', label: 'งาน/ออฟฟิศ', Icon: Briefcase },
  { key: 'wallet', label: 'การเงิน', Icon: Wallet },
  { key: 'message', label: 'แชท/ทีม', Icon: MessageSquare },
  { key: 'cloud', label: 'คลาวด์', Icon: Cloud },
  { key: 'shield', label: 'ความปลอดภัย', Icon: ShieldCheck },
  { key: 'terminal', label: 'เทอร์มินัล', Icon: Terminal },
  { key: 'database', label: 'ฐานข้อมูล', Icon: Database },
  { key: 'palette', label: 'ออกแบบ', Icon: Palette },
  { key: 'mail', label: 'อีเมล', Icon: Mail },
  { key: 'folder', label: 'ไฟล์', Icon: Folder },
];

export const PRESET_TONES: Array<{
  key: string;
  label: string;
  bgClass: string;
  textClass: string;
  swatchClass: string;
}> = [
  {
    key: 'cobalt',
    label: 'น้ำเงินโคบอลต์',
    bgClass: 'bg-gradient-to-br from-blue-500 to-indigo-600 border-blue-400/40 shadow-sm shadow-blue-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-blue-500 to-indigo-600',
  },
  {
    key: 'emerald',
    label: 'เขียวมรกต',
    bgClass: 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400/40 shadow-sm shadow-emerald-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-emerald-500 to-teal-600',
  },
  {
    key: 'violet',
    label: 'ม่วงไวโอเล็ต',
    bgClass: 'bg-gradient-to-br from-violet-500 to-purple-600 border-violet-400/40 shadow-sm shadow-violet-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-violet-500 to-purple-600',
  },
  {
    key: 'amber',
    label: 'ส้มอำพัน',
    bgClass: 'bg-gradient-to-br from-amber-400 to-orange-500 border-amber-300/40 shadow-sm shadow-amber-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-amber-400 to-orange-500',
  },
  {
    key: 'rose',
    label: 'ชมพูโรส',
    bgClass: 'bg-gradient-to-br from-rose-500 to-pink-600 border-rose-400/40 shadow-sm shadow-rose-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-rose-500 to-pink-600',
  },
  {
    key: 'cyan',
    label: 'ฟ้าไซแอน',
    bgClass: 'bg-gradient-to-br from-cyan-500 to-sky-600 border-cyan-400/40 shadow-sm shadow-cyan-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-cyan-500 to-sky-600',
  },
  {
    key: 'slate',
    label: 'เทาสเลต',
    bgClass: 'bg-gradient-to-br from-slate-600 to-slate-800 border-slate-500/40 shadow-sm shadow-slate-500/20',
    textClass: 'text-white',
    swatchClass: 'bg-gradient-to-br from-slate-600 to-slate-800',
  },
];

export function AppLogo({
  name,
  logoType,
  logoValue,
  targetUrl,
  size = 'md',
}: AppLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const sizeClass =
    size === 'sm'
      ? 'w-9 h-9 rounded-lg'
      : size === 'lg'
        ? 'w-14 h-14 rounded-2xl'
        : 'w-11 h-11 rounded-xl';

  const iconSizeClass =
    size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  let resolvedSrc: string | null = null;
  if (logoType === 'upload' && isSafeImageUrl(logoValue)) {
    resolvedSrc = logoValue;
  } else if (logoType === 'url' && isSafeImageUrl(logoValue)) {
    resolvedSrc = logoValue;
  } else if (logoType === 'favicon') {
    resolvedSrc = getFaviconUrl(logoValue || targetUrl);
  }

  useEffect(() => {
    setImgFailed(false);
  }, [logoType, logoValue, targetUrl]);

  if (resolvedSrc && !imgFailed) {
    return (
      <div
        className={`${sizeClass} shrink-0 overflow-hidden border border-slate-200/90 bg-white dark:border-slate-700/90 dark:bg-slate-800 shadow-xs flex items-center justify-center transition-shadow`}
      >
        <img
          src={resolvedSrc}
          alt={`โลโก้ ${name}`}
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain p-1.5"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  if (logoType === 'preset_icon') {
    const [iconKey, toneKey] = (logoValue || 'globe:cobalt').split(':');
    const preset = PRESET_ICONS.find((p) => p.key === iconKey) ?? PRESET_ICONS[0];
    const tone = PRESET_TONES.find((t) => t.key === toneKey) ?? PRESET_TONES[0];
    const Icon = preset.Icon;

    return (
      <div
        className={`${sizeClass} shrink-0 border flex items-center justify-center transition-shadow ${tone.bgClass} ${tone.textClass}`}
        aria-label={`ไอคอน ${name}`}
      >
        <Icon className={iconSizeClass} />
      </div>
    );
  }

  // Colorful deterministic monogram fallback when favicon/image fails or is missing
  const initial = (name.trim().charAt(0) || 'A').toUpperCase();
  const gradientClass = getMonogramGradient(name);
  return (
    <div
      className={`${sizeClass} shrink-0 bg-gradient-to-br ${gradientClass} text-white shadow-xs flex items-center justify-center font-bold ${
        size === 'lg' ? 'text-lg' : 'text-sm'
      }`}
      aria-label={`ตัวอักษรย่อ ${name}`}
    >
      {initial}
    </div>
  );
}
