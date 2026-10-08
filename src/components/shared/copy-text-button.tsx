'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

const COPIED_RESET_MS = 2000

type CopyTextButtonProps = {
  text: string
  label: string
  copiedLabel: string
}

/**
 * Copies `text` to the clipboard and confirms in place. The labels arrive
 * translated from the server, so this file holds no copy of its own.
 *
 * On a failed write the label stays as it was: the text this copies is
 * printed beside the button and can still be selected by hand.
 */
export function CopyTextButton({ text, label, copiedLabel }: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  return (
    <>
      <Button variant="ghost" size="compact" onClick={handleCopy}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? copiedLabel : label}
      </Button>
      {/* Rendered unconditionally so the live region exists before the
          announcement; only its text changes. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  )
}
