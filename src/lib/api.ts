import { auth } from './firebase';
import { executeClientFirestoreFallback } from './clientFirestoreOps';

export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
    forceRefreshToken?: boolean;
  } = {}
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to continue.');
  }

  const method = options.method || 'GET';
  const idToken = await currentUser.getIdToken(Boolean(options.forceRefreshToken));

  try {
    const res = await fetch(path, {
      method,
      headers: {
        'X-Firebase-Token': idToken,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Static host (e.g., Netlify/Vercel/Firebase Hosting) returned SPA HTML or 404 instead of Express JSON API
      return await executeClientFirestoreFallback<T>(path, method, options.body);
    }

    if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
      return await executeClientFirestoreFallback<T>(path, method, options.body);
    }

    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      // Network fetch error when no backend server is present
      return await executeClientFirestoreFallback<T>(path, method, options.body);
    }
    throw err;
  }
}

export async function compressImageFile(
  file: File,
  purpose: 'avatar' | 'proof'
): Promise<{ dataUrl: string; mimeType: 'image/webp' | 'image/jpeg'; sizeBytes: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, or WebP).');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Selected image must be smaller than 12 MB.');
  }

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected image.'));
      el.src = bitmapUrl;
    });

    const maxDim = purpose === 'avatar' ? 320 : 960;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (purpose === 'avatar') {
      // Center-crop square avatar
      const side = Math.min(width, height);
      const sx = Math.floor((width - side) / 2);
      const sy = Math.floor((height - side) / 2);
      const targetSide = Math.min(side, maxDim);
      const canvas = document.createElement('canvas');
      canvas.width = targetSide;
      canvas.height = targetSide;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image processing unavailable.');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSide, targetSide);
      return encodeCanvasWithinLimit(canvas);
    } else {
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image processing unavailable.');
      ctx.drawImage(img, 0, 0, width, height);
      return encodeCanvasWithinLimit(canvas);
    }
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

function encodeCanvasWithinLimit(canvas: HTMLCanvasElement): {
  dataUrl: string;
  mimeType: 'image/webp' | 'image/jpeg';
  sizeBytes: number;
} {
  const qualities = [0.82, 0.72, 0.6, 0.48, 0.36];
  for (const q of qualities) {
    let mimeType: 'image/webp' | 'image/jpeg' = 'image/webp';
    let dataUrl = canvas.toDataURL('image/webp', q);
    if (!dataUrl.startsWith('data:image/webp')) {
      mimeType = 'image/jpeg';
      dataUrl = canvas.toDataURL('image/jpeg', q);
    }
    const base64Part = dataUrl.split(',')[1] || '';
    const sizeBytes = Math.ceil((base64Part.length * 3) / 4);
    if (sizeBytes <= 185000 && dataUrl.length <= 245000) {
      return { dataUrl, mimeType, sizeBytes };
    }
  }
  throw new Error('Image is too complex to compress securely. Please crop or choose a clearer screenshot.');
}

export async function uploadCompressedMedia(
  file: File,
  purpose: 'avatar' | 'proof'
): Promise<{ assetId: string; previewDataUrl: string }> {
  const compressed = await compressImageFile(file, purpose);
  const res = await apiRequest<{ ok: boolean; assetId: string }>('/api/media/upload', {
    method: 'POST',
    body: {
      purpose,
      mimeType: compressed.mimeType,
      dataUrl: compressed.dataUrl,
    },
  });
  return { assetId: res.assetId, previewDataUrl: compressed.dataUrl };
}

export function formatBdt(amount: number | undefined | null): string {
  const num = Number(amount || 0);
  return `৳${num.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof ts === 'object') {
    const candidate = ts as { toMillis?: () => number; seconds?: number };
    if (typeof candidate.toMillis === 'function') {
      return candidate.toMillis();
    }
    if (typeof candidate.seconds === 'number') {
      return candidate.seconds * 1000;
    }
  }
  return 0;
}

export function formatDateTime(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return 'Just now';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function formatShortDate(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return 'Recent';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}
