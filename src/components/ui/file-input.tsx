'use client'

import type { ChangeEvent, Ref } from 'react'
import { cn } from '@/lib/utils'

type FileInputProps = {
  id?: string
  accept?: string
  multiple?: boolean
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  className?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * Visually hidden `<input type="file">` driven by a separate trigger that calls
 * `ref.current?.click()`. Hidden with `sr-only` rather than `hidden` so the
 * control stays in the accessibility tree and remains reachable by assistive
 * technology.
 */
function FileInput({ id, accept, multiple, onChange, className, ref }: FileInputProps) {
  return (
    <input
      ref={ref}
      id={id}
      type="file"
      data-slot="file-input"
      accept={accept}
      multiple={multiple}
      onChange={onChange}
      className={cn('sr-only', className)}
    />
  )
}

export { FileInput }
export type { FileInputProps }
