'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

type DynamicArrayFieldProps<T extends object> = {
  initialItems: T[]
  renderItem: (item: T, index: number, onRemove: () => void) => React.ReactNode
  createItem: () => T
  addLabel: string
  maxItems?: number
}

export function DynamicArrayField<T extends object>({
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
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={addItem}
        disabled={maxItems !== undefined && items.length >= maxItems}
      >
        {addLabel}
      </Button>
    </div>
  )
}
