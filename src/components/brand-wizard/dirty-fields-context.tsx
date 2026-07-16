'use client'

import { createContext, useContext } from 'react'
export type DirtyFields = Partial<Readonly<Record<string, unknown>>>

export const DirtyFieldsContext = createContext<DirtyFields>({})

export function useDirtyFields() {
  return useContext(DirtyFieldsContext)
}
