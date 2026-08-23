'use client'

import { createContext, useContext } from 'react'
type DirtyFields = Partial<Readonly<Record<string, unknown>>>

const DirtyFieldsContext = createContext<DirtyFields>({})

export function useDirtyFields() {
  return useContext(DirtyFieldsContext)
}
