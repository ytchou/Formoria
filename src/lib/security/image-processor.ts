import sharp from 'sharp'

export interface ProcessedImage {
  buffer: Buffer
  contentType: 'image/webp'
  width: number
  height: number
  originalSize: number
  processedSize: number
}

export interface ImageProcessorConfig {
  maxFileSizeBytes: number
  maxWidth: number
  maxHeight: number
  quality: number
}

// Static raster formats only. Without this, sharp accepts animated GIFs
// (silently flattened to their first frame) and SVGs, both of which every
// caller — owner/admin uploads and enrichment downloads alike — treats as a
// plain photo.
const ALLOWED_INPUT_FORMATS = ['jpeg', 'png', 'webp'] as const

export const DEFAULT_CONFIG: ImageProcessorConfig = {
  maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 80,
}

export async function processImage(
  buffer: Buffer,
  config: Partial<ImageProcessorConfig> = {}
): Promise<ProcessedImage> {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // 1. Check file size
  if (buffer.length > cfg.maxFileSizeBytes) {
    throw new Error(
      `File size ${buffer.length} exceeds maximum allowed size of ${cfg.maxFileSizeBytes} bytes`
    )
  }

  // 2. Enforce the input format allowlist. metadata() itself throws
  // "unsupported image format" on non-image bytes, so this only has to reject
  // formats sharp is willing to decode but we do not want (gif, svg, tiff, …).
  const { format } = await sharp(buffer).metadata()
  if (
    !format ||
    !(ALLOWED_INPUT_FORMATS as readonly string[]).includes(format)
  ) {
    throw new Error(
      `Unsupported image format "${format ?? 'unknown'}"; allowed formats: ${ALLOWED_INPUT_FORMATS.join(', ')}`
    )
  }

  // 3. Process: auto-rotate (strips EXIF), resize (fit inside, no upscale), encode to WebP
  const processed = await sharp(buffer)
    .rotate() // auto-rotate based on EXIF orientation, strips EXIF
    .resize({
      width: cfg.maxWidth,
      height: cfg.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: cfg.quality })
    .toBuffer({ resolveWithObject: true })

  return {
    buffer: processed.data,
    contentType: 'image/webp',
    width: processed.info.width,
    height: processed.info.height,
    originalSize: buffer.length,
    processedSize: processed.data.length,
  }
}
