'use client'

import { createContext, useContext } from 'react'
import type { FieldNamesMarkedBoolean } from 'react-hook-form'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export type DirtyFields = Partial<Readonly<FieldNamesMarkedBoolean<BrandEditFormValues>>>

export const DirtyFieldsContext = createContext<DirtyFields>({})

export function useDirtyFields() {
  return useContext(DirtyFieldsContext)
}
