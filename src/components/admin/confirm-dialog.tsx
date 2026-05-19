'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
  confirmLabel: string
  variant?: 'default' | 'destructive'
  confirmText?: string
  isPending?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel,
  variant = 'default',
  confirmText,
  isPending = false,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('')

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setInputValue('')
    onOpenChange(nextOpen)
  }

  const isConfirmDisabled =
    isPending || (confirmText != null && inputValue !== confirmText)

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {confirmText != null && (
          <div className="px-1">
            <Input
              placeholder={`Type "${confirmText}" to confirm`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isConfirmDisabled}
          >
            {isPending ? 'Processing...' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
