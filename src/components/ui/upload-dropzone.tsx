'use client'

import { Upload } from 'lucide-react'
import { useRef, type ChangeEvent } from 'react'
import { FileInput } from '@/components/ui/file-input'
import { FOCUS_RING } from '@/components/ui/control-surface'
import { cn } from '@/lib/utils'

type UploadDropzoneProps = {
  /** id applied to the underlying file input */
  id?: string
  accept?: string
  multiple?: boolean
  /** Label rendered inside the dashed target. */
  hint: string
  disabled?: boolean
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void
  className?: string
}

/**
 * Dashed, intrinsically tall click target that opens a hidden `FileInput`.
 * Not a Button variant: it is a full-width drop-target affordance, not an action
 * control, so it does not go through `buttonVariants()`.
 */
function UploadDropzone({
  id,
  accept,
  multiple,
  hint,
  disabled,
  onFileSelect,
  className,
}: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        data-slot="upload-dropzone"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={cn(
          'flex min-h-24 w-full items-center justify-center gap-2 rounded-control border border-dashed border-rule bg-surface px-4 py-4 type-metadata transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60',
          FOCUS_RING,
          className
        )}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        <span>{hint}</span>
      </button>
      <FileInput
        ref={inputRef}
        id={id}
        accept={accept}
        multiple={multiple}
        onChange={onFileSelect}
      />
    </>
  )
}

export { UploadDropzone }
