export const MAX_IMAGE_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateImageAttachments(input) {
  if (input === undefined) return { ok: true, images: [], totalBytes: 0 };
  if (!Array.isArray(input)) return { ok: false, status: 400, error: 'Photo attachments must be provided as a list.' };
  if (input.length > MAX_IMAGE_ATTACHMENTS) {
    return { ok: false, status: 400, error: 'You can attach up to five photos per analysis.' };
  }

  const images = [];
  let totalBytes = 0;
  for (const image of input) {
    if (!image || !SUPPORTED_IMAGE_TYPES.has(image.mimeType)) {
      return { ok: false, status: 400, error: 'Use JPEG, PNG or WebP photos.' };
    }
    const data = typeof image.data === 'string' ? image.data : '';
    if (!data || data.length > 2_000_000 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return { ok: false, status: 400, error: 'One of the photos is invalid or too large after compression.' };
    }
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    const imageBytes = Math.floor(data.length * 3 / 4) - padding;
    if (imageBytes <= 0 || imageBytes > MAX_IMAGE_BYTES) {
      return { ok: false, status: 413, error: 'Each compressed photo must be 1.5 MB or smaller.' };
    }
    totalBytes += imageBytes;
    images.push({ mimeType: image.mimeType, data });
  }

  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    return { ok: false, status: 413, error: 'The five photos together must be 5 MB or smaller after compression.' };
  }
  return { ok: true, images, totalBytes };
}
