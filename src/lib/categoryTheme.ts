export interface CategoryVisualTheme {
  topBarClass: string;
  tileHoverClass: string;
  iconGlowClass: string;
  textAccentClass: string;
  monogramClass: string;
}

const CATEGORY_THEMES: Array<{ keywords: string[]; theme: CategoryVisualTheme }> = [
  {
    keywords: ['งาน', 'work', 'office'],
    theme: {
      topBarClass: 'from-blue-500 via-indigo-500 to-sky-400',
      tileHoverClass:
        'hover:border-blue-400/80 dark:hover:border-blue-400/60 hover:bg-gradient-to-b hover:from-white hover:to-blue-50/70 dark:hover:from-slate-900 dark:hover:to-blue-950/30 hover:shadow-md hover:shadow-blue-500/10',
      iconGlowClass: 'group-hover:ring-4 group-hover:ring-blue-500/15',
      textAccentClass: 'text-blue-600 dark:text-blue-400',
      monogramClass: 'from-blue-500 to-indigo-600',
    },
  },
  {
    keywords: ['พัฒนา', 'dev', 'code', 'tech', 'ซอฟต์แวร์'],
    theme: {
      topBarClass: 'from-violet-500 via-purple-500 to-indigo-500',
      tileHoverClass:
        'hover:border-violet-400/80 dark:hover:border-violet-400/60 hover:bg-gradient-to-b hover:from-white hover:to-violet-50/70 dark:hover:from-slate-900 dark:hover:to-violet-950/30 hover:shadow-md hover:shadow-violet-500/10',
      iconGlowClass: 'group-hover:ring-4 group-hover:ring-violet-500/15',
      textAccentClass: 'text-violet-600 dark:text-violet-400',
      monogramClass: 'from-violet-500 to-purple-600',
    },
  },
  {
    keywords: ['การเงิน', 'ธนาคาร', 'finance', 'bank', 'money'],
    theme: {
      topBarClass: 'from-emerald-500 via-teal-500 to-cyan-500',
      tileHoverClass:
        'hover:border-emerald-400/80 dark:hover:border-emerald-400/60 hover:bg-gradient-to-b hover:from-white hover:to-emerald-50/70 dark:hover:from-slate-900 dark:hover:to-emerald-950/30 hover:shadow-md hover:shadow-emerald-500/10',
      iconGlowClass: 'group-hover:ring-4 group-hover:ring-emerald-500/15',
      textAccentClass: 'text-emerald-600 dark:text-emerald-400',
      monogramClass: 'from-emerald-500 to-teal-600',
    },
  },
  {
    keywords: ['ออกแบบ', 'design', 'art', 'creative'],
    theme: {
      topBarClass: 'from-rose-500 via-pink-500 to-orange-400',
      tileHoverClass:
        'hover:border-rose-400/80 dark:hover:border-rose-400/60 hover:bg-gradient-to-b hover:from-white hover:to-rose-50/70 dark:hover:from-slate-900 dark:hover:to-rose-950/30 hover:shadow-md hover:shadow-rose-500/10',
      iconGlowClass: 'group-hover:ring-4 group-hover:ring-rose-500/15',
      textAccentClass: 'text-rose-600 dark:text-rose-400',
      monogramClass: 'from-rose-500 to-pink-600',
    },
  },
  {
    keywords: ['โซเชียล', 'สื่อสาร', 'chat', 'social', 'mail'],
    theme: {
      topBarClass: 'from-amber-400 via-orange-500 to-rose-400',
      tileHoverClass:
        'hover:border-amber-400/80 dark:hover:border-amber-400/60 hover:bg-gradient-to-b hover:from-white hover:to-amber-50/70 dark:hover:from-slate-900 dark:hover:to-amber-950/30 hover:shadow-md hover:shadow-amber-500/10',
      iconGlowClass: 'group-hover:ring-4 group-hover:ring-amber-500/15',
      textAccentClass: 'text-amber-600 dark:text-amber-400',
      monogramClass: 'from-amber-500 to-orange-600',
    },
  },
  {
    keywords: ['คลาวด์', 'เซิร์ฟเวอร์', 'cloud', 'server', 'infra'],
    theme: {
      topBarClass: 'from-cyan-500 via-sky-500 to-blue-500',
      tileHoverClass:
        'hover:border-cyan-400/80 dark:hover:border-cyan-400/60 hover:bg-gradient-to-b hover:from-white hover:to-cyan-50/70 dark:hover:from-slate-900 dark:hover:to-cyan-950/30 hover:shadow-md hover:shadow-cyan-500/10',
      iconGlowClass: 'group-hover:ring-4 group-hover:ring-cyan-500/15',
      textAccentClass: 'text-cyan-600 dark:text-cyan-400',
      monogramClass: 'from-cyan-500 to-sky-600',
    },
  },
];

const FALLBACK_THEMES: CategoryVisualTheme[] = CATEGORY_THEMES.map((entry) => entry.theme);

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getCategoryTheme(category: string): CategoryVisualTheme {
  const lower = category.trim().toLowerCase();
  for (const entry of CATEGORY_THEMES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.theme;
    }
  }
  const idx = hashString(lower || 'default') % FALLBACK_THEMES.length;
  return FALLBACK_THEMES[idx];
}

const MONOGRAM_GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-cyan-500 to-sky-600',
];

export function getMonogramGradient(name: string): string {
  const idx = hashString(name.trim().toLowerCase() || 'a') % MONOGRAM_GRADIENTS.length;
  return MONOGRAM_GRADIENTS[idx];
}
