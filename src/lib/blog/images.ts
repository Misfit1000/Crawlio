import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { safePublicFetch } from '../security/safe-public-fetch';
import { getSupabaseAdminClient } from '../supabase/server';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const RESPONSIVE_WIDTHS = [320, 480, 768, 1024, 1280, 1600];
const MAX_INPUT_PIXELS = 40_000_000;

export interface BlogImageImportInput {
  sourceUrl: string;
  creator?: string;
  publisher: string;
  licence: string;
  attribution?: string;
  attributionUrl?: string;
  altText: string;
  caption?: string;
  articleId?: string | null;
}

function clean(value: unknown, maximum: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function dimensions(buffer: Buffer, contentType: string) {
  if (contentType === 'image/png' && buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (contentType === 'image/gif' && buffer.length >= 10 && buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (contentType === 'image/webp' && buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = buffer.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (contentType === 'image/jpeg' && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return { width: null, height: null };
}

function signatureMatches(buffer: Buffer, contentType: string) {
  if (contentType === 'image/png') return buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(12, 16).toString('ascii') === 'IHDR';
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/gif') return /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'));
  if (contentType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (contentType === 'image/avif') return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(buffer.subarray(8, 24).toString('ascii'));
  return false;
}

export function validateBlogImageBuffer(buffer: Buffer, contentTypeValue: string) {
  const contentType = contentTypeValue.toLowerCase().split(';')[0].trim();
  if (!ALLOWED_TYPES.includes(contentType) || !signatureMatches(buffer, contentType)) throw new Error('The response is not a supported raster image. SVG files are not accepted.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the five-megabyte import limit.');
  const measured = dimensions(buffer, contentType);
  if (measured.width != null && measured.height != null && (measured.width < 320 || measured.height < 180)) throw new Error('Image is too small for an article image. Use at least 320 by 180 pixels.');
  return { contentType, ...measured, fileSize: buffer.length };
}

export async function generateResponsiveImageVariants(buffer: Buffer, contentType: string) {
  const image = sharp(buffer, { animated: false, failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions could not be verified.');
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) throw new Error('Image dimensions exceed the safe processing limit.');
  const widths = RESPONSIVE_WIDTHS.filter((width) => width <= metadata.width!);
  const uniqueWidths = [...new Set(widths)].sort((left, right) => left - right);
  const variants: Array<{ width: number; height: number; format: 'webp' | 'avif'; mimeType: string; buffer: Buffer; fileSize: number }> = [];
  for (const width of uniqueWidths) {
    const height = Math.max(1, Math.round(metadata.height * (width / metadata.width)));
    const resized = sharp(buffer, { animated: false, failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({ width, height, fit: 'inside', withoutEnlargement: true });
    const webp = await resized.clone().webp({ quality: 82, effort: 4 }).toBuffer();
    variants.push({ width, height, format: 'webp', mimeType: 'image/webp', buffer: webp, fileSize: webp.length });
    const avif = await resized.clone().avif({ quality: 50, effort: 4 }).toBuffer();
    variants.push({ width, height, format: 'avif', mimeType: 'image/avif', buffer: avif, fileSize: avif.length });
  }
  return { width: metadata.width, height: metadata.height, sourceContentType: contentType, variants };
}

export async function importBlogImage(input: BlogImageImportInput) {
  const publisher = clean(input.publisher, 160);
  const licence = clean(input.licence, 120);
  const altText = clean(input.altText, 240);
  if (!publisher || !licence || altText.length < 8) throw new Error('Publisher, licence, and descriptive alt text are required.');
  let sourceUrl: URL;
  try { sourceUrl = new URL(input.sourceUrl); } catch { throw new Error('Image source must be a public HTTPS URL.'); }
  if (sourceUrl.protocol !== 'https:') throw new Error('Image source must be a public HTTPS URL.');

  const response = await safePublicFetch(sourceUrl.toString(), {
    timeoutMs: 10_000,
    maxRedirects: 3,
    maxBytes: MAX_IMAGE_BYTES,
    allowedContentTypes: ALLOWED_TYPES,
    returnBuffer: true,
  });
  const contentType = response.contentType.toLowerCase().split(';')[0].trim();
  const buffer = response.bodyBuffer || Buffer.alloc(0);
  if (response.status < 200 || response.status >= 300) throw new Error(`Image source returned HTTP ${response.status}.`);
  const measured = validateBlogImageBuffer(buffer, contentType);

  const client = getSupabaseAdminClient();
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[contentType];
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  const storagePath = `${new Date().getUTCFullYear()}/${digest}/original.${extension}`;
  const generated = await generateResponsiveImageVariants(buffer, contentType);
  let storageUrl = response.finalUrl;
  if (client) {
    const { error: uploadError } = await client.storage.from('blog-images').upload(storagePath, buffer, { contentType, cacheControl: '31536000', upsert: true });
    if (uploadError) throw uploadError;
    storageUrl = client.storage.from('blog-images').getPublicUrl(storagePath).data.publicUrl;
  }

  const record = {
    article_id: input.articleId || null,
    source_url: response.finalUrl,
    storage_url: storageUrl,
    creator: clean(input.creator, 160),
    publisher,
    licence,
    attribution: clean(input.attribution || `${clean(input.creator, 160) || publisher} / ${licence}`, 300),
    attribution_url: clean(input.attributionUrl, 500) || null,
    width: measured.width,
    height: measured.height,
    file_type: contentType,
    file_size: response.bodyBytes,
    alt_text: altText,
    caption: clean(input.caption, 300),
    relevance_status: 'passed',
    validation_status: 'passed',
    validated_at: new Date().toISOString(),
  };
  if (!client) return { id: randomUUID(), ...record, stored: false, variants: generated.variants.map(({ buffer: _buffer, ...variant }) => ({ ...variant, storage_path: '', storage_url: response.finalUrl, processing_status: 'ready' })), srcset: generated.variants.filter((variant) => variant.format === 'webp').map((variant) => `${response.finalUrl} ${variant.width}w`).join(', ') };
  const { data, error } = await client.from('blog_images').insert(record).select('*').single();
  if (error) throw error;
  const variantRows = [];
  try {
    for (const variant of generated.variants) {
      const variantPath = `${new Date().getUTCFullYear()}/${digest}/${variant.width}.${variant.format}`;
      const { error: variantUploadError } = await client.storage.from('blog-images').upload(variantPath, variant.buffer, { contentType: variant.mimeType, cacheControl: '31536000', upsert: true });
      if (variantUploadError) throw variantUploadError;
      variantRows.push({
        image_id: data.id, width: variant.width, height: variant.height, format: variant.format, mime_type: variant.mimeType,
        file_size: variant.fileSize, storage_path: variantPath, storage_url: client.storage.from('blog-images').getPublicUrl(variantPath).data.publicUrl,
        content_hash: digest, processing_status: 'ready',
      });
    }
    const { data: savedVariants, error: variantError } = await client.from('blog_image_variants').upsert(variantRows, { onConflict: 'image_id,width,format' }).select('*');
    if (variantError) throw variantError;
    const webpVariants = (savedVariants || []).filter((variant) => variant.format === 'webp').sort((left, right) => left.width - right.width);
    return { ...data, stored: true, variants: savedVariants || [], srcset: webpVariants.map((variant) => `${variant.storage_url} ${variant.width}w`).join(', ') };
  } catch (variantError) {
    await client.from('blog_images').update({ validation_status: 'blocked', relevance_status: 'needs_review' }).eq('id', data.id);
    throw variantError;
  }
}

export async function cleanupOrphanedBlogImageVariants(olderThanHours = 168) {
  const client = getSupabaseAdminClient();
  if (!client) return { deletedImages: 0, deletedObjects: 0 };
  const cutoff = new Date(Date.now() - Math.max(24, olderThanHours) * 60 * 60 * 1000).toISOString();
  const { data: images, error } = await client.from('blog_images').select('id,storage_url').is('article_id', null).lt('created_at', cutoff).limit(100);
  if (error) throw error;
  let deletedObjects = 0;
  for (const image of images || []) {
    const { data: variants, error: variantError } = await client.from('blog_image_variants').select('storage_path').eq('image_id', image.id);
    if (variantError) throw variantError;
    const paths = (variants || []).map((variant) => variant.storage_path).filter(Boolean);
    if (paths.length) {
      const { error: removeError } = await client.storage.from('blog-images').remove(paths);
      if (removeError) throw removeError;
      deletedObjects += paths.length;
    }
    const { error: deleteError } = await client.from('blog_images').delete().eq('id', image.id);
    if (deleteError) throw deleteError;
  }
  return { deletedImages: (images || []).length, deletedObjects };
}
