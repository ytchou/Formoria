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
  minWidth: number
  minHeight: number
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
  minWidth: 200,
  minHeight: 200,
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
  const meta = await sharp(buffer).metadata()
  if (
    !meta.format ||
    !(ALLOWED_INPUT_FORMATS as readonly string[]).includes(meta.format)
  ) {
    throw new Error(
      `Unsupported image format "${meta.format ?? 'unknown'}"; allowed formats: ${ALLOWED_INPUT_FORMATS.join(', ')}`
    )
  }

  // 3. Reject images below the minimum dimensions.
  const srcWidth = meta.width ?? 0
  const srcHeight = meta.height ?? 0
  if (srcWidth < cfg.minWidth || srcHeight < cfg.minHeight) {
    throw new Error(
      `Image dimensions ${srcWidth}×${srcHeight} are below the minimum ${cfg.minWidth}×${cfg.minHeight}`
    )
  }

  // 4. Process: auto-rotate (strips EXIF), resize (fit inside, no upscale), encode to WebP
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
