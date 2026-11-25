export interface UrlValidationResult {
  valid: boolean;
  kind: 'web' | 'deeplink' | 'invalid';
  normalizedUrl: string;
  displayHost: string;
  error?: string;
}

const BLOCKED_SCHEMES = ['javascript:', 'vbscript:', 'data:', 'blob:', 'file:'];
const DEEP_LINK_REGEX = /^([a-z][a-z0-9+.-]{1,20}):\/\/([^\s]+)$/i;

export function validateTargetUrl(rawInput: string): UrlValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      kind: 'invalid',
      normalizedUrl: '',
      displayHost: '',
      error: 'กรุณาระบุ URL หรือ Deep Link ของแอป',
    };
  }

  // Strip invisible control chars
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return {
      valid: false,
      kind: 'invalid',
      normalizedUrl: '',
      displayHost: '',
      error: 'พบอักขระควบคุมที่ไม่อนุญาตในลิงก์',
    };
  }

  const lower = trimmed.toLowerCase();
  for (const blocked of BLOCKED_SCHEMES) {
    if (lower.startsWith(blocked)) {
      return {
        valid: false,
        kind: 'invalid',
        normalizedUrl: '',
        displayHost: '',
        error: `บล็อกโปรโตคอล ${blocked} เพื่อความปลอดภัย`,
      };
    }
  }

  // Auto-prepend https:// when user types a plain domain like github.com
  const candidate =
    trimmed.includes('://') || lower.startsWith('mailto:')
      ? trimmed
      : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      if (!parsed.hostname) {
        return {
          valid: false,
          kind: 'invalid',
          normalizedUrl: '',
          displayHost: '',
          error: 'ไม่พบชื่อโดเมนที่ถูกต้อง',
        };
      }
      return {
        valid: true,
        kind: 'web',
        normalizedUrl: parsed.toString(),
        displayHost: parsed.hostname.replace(/^www\./, ''),
      };
    }
  } catch {
    // Fall through to deep link check
  }

  const deepMatch = trimmed.match(DEEP_LINK_REGEX);
  if (deepMatch) {
    const scheme = deepMatch[1].toLowerCase();
    if (['javascript', 'vbscript', 'data', 'blob', 'file'].includes(scheme)) {
      return {
        valid: false,
        kind: 'invalid',
        normalizedUrl: '',
        displayHost: '',
        error: `ไม่อนุญาตโปรโตคอล ${scheme}://`,
      };
    }
    return {
      valid: true,
      kind: 'deeplink',
      normalizedUrl: trimmed,
      displayHost: `${scheme}://`,
    };
  }

  return {
    valid: false,
    kind: 'invalid',
    normalizedUrl: '',
    displayHost: '',
    error: 'รูปแบบลิงก์ไม่ถูกต้อง (รองรับ https://, http:// หรือ deep link เช่น vscode://)',
  };
}

export function isSafeImageUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/png;base64,') || trimmed.startsWith('data:image/jpeg;base64,') || trimmed.startsWith('data:image/webp;base64,')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getFaviconUrl(targetUrl: string): string | null {
  const validation = validateTargetUrl(targetUrl);
  if (!validation.valid || validation.kind !== 'web') {
    return null;
  }
  try {
    const parsed = new URL(validation.normalizedUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=128`;
  } catch {
    return null;
  }
}

export async function rasterizeUploadedLogo(file: File): Promise<string> {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('รองรับเฉพาะไฟล์ PNG, JPG หรือ WebP เพื่อความปลอดภัย');
  }

  if (file.size > 2 * 1024 * 1024) {
    throw new Error('ขนาดไฟล์รูปต้องไม่เกิน 2 MB');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์รูปภาพเสียหายหรือไม่รองรับ'));
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('ไม่สามารถประมวลผลรูปภาพได้'));
          return;
        }

        ctx.clearRect(0, 0, size, size);
        const scale = Math.min(size / img.width, size / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const offsetX = (size - drawW) / 2;
        const offsetY = (size - drawH) / 2;
        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

        resolve(canvas.toDataURL('image/png', 0.92));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
