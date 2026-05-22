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
  allowedFormats: string[]
}

export const DEFAULT_CONFIG: ImageProcessorConfig = {
  maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 80,
  allowedFormats: ['jpeg', 'png', 'webp'],
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

  // 2. Read metadata to validate format (magic bytes via sharp)
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer).metadata()
  } catch {
    throw new Error('Invalid image format: could not read image metadata')
  }

  if (!metadata.format || !cfg.allowedFormats.includes(metadata.format)) {
    throw new Error(
      `Unsupported image format: ${metadata.format ?? 'unknown'}. Allowed formats: ${cfg.allowedFormats.join(', ')}`
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
