'use client'
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'

type KeyedItem<T> = { key: number; item: T }

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
  const keyCounter = useRef(initialItems.length)
  const [items, setItems] = useState<KeyedItem<T>[]>(() =>
    initialItems.map((item, i) => ({ key: i, item }))
  )

  function addItem() {
    if (maxItems !== undefined && items.length >= maxItems) return
    setItems([...items, { key: keyCounter.current++, item: createItem() }])
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {items.map((entry, index) => (
        <div key={entry.key}>
          {renderItem(entry.item, index, () => removeItem(index))}
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={addItem}
        disabled={maxItems !== undefined && items.length >= maxItems}
      >
        {addLabel}
      </Button>
    </div>
  )
}
