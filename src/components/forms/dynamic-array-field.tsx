'use client'
import { useState } from 'react'

type DynamicArrayFieldProps<T extends object> = {
  name?: string
  initialItems: T[]
  renderItem: (item: T, index: number, onRemove: () => void) => React.ReactNode
  createItem: () => T
  addLabel: string
  maxItems?: number
}

export function DynamicArrayField<T extends object>({
  name,
  initialItems,
  renderItem,
  createItem,
  addLabel,
  maxItems,
}: DynamicArrayFieldProps<T>) {
  const [items, setItems] = useState<T[]>(initialItems)

  function addItem() {
    if (maxItems !== undefined && items.length >= maxItems) return
    setItems([...items, createItem()])
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index}>
          {renderItem(item, index, () => removeItem(index))}
          {name &&
            Object.entries(item as Record<string, unknown>).map(([key, value]) => (
              <input
                key={key}
                type="hidden"
                name={`${name}[${index}].${key}`}
                value={String(value ?? '')}
              />
            ))}
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        disabled={maxItems !== undefined && items.length >= maxItems}
        className="text-sm font-medium text-[#8B5E3C] hover:underline disabled:opacity-50"
      >
        {addLabel}
      </button>
    </div>
  )
}
