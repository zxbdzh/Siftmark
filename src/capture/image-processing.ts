export const THUMBNAIL_MAX_EDGE = 1280;
export const THUMBNAIL_WEBP_QUALITY = 0.72;

export interface ProcessedImage { blob: Blob; width: number; height: number; hash: string }

export function fitWithin(width: number, height: number, maximum = THUMBNAIL_MAX_EDGE): { width: number; height: number } {
  if (width <= maximum && height <= maximum) return { width, height };
  const scale = maximum / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function processImageDataUrl(dataUrl: string): Promise<ProcessedImage> {
  const source = await fetch(dataUrl).then((response) => response.blob());
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(source); }
  catch { throw new Error('decode'); }
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('decode');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: THUMBNAIL_WEBP_QUALITY });
    return { blob, ...size, hash: await sha256(blob) };
  } finally { bitmap.close(); }
}

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
