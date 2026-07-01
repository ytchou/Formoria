'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ImageUploader } from '../upload/ImageUploader'

type ProductPhoto = {
  id: string
  url: string
}

type ProductPhotosFieldProps = {
  name?: string
  brandId: string
  defaultPhotos: string[]
}

function SortablePhoto({
  photo,
  isCover,
  onRemove,
}: {
  photo: ProductPhoto
  isCover: boolean
  onRemove: () => void
}) {
  const t = useTranslations('forms.photos')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative overflow-hidden rounded-xl border border-border bg-card ${
        isDragging ? 'z-10 ring-2 ring-cta' : ''
      }`}
      {...attributes}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          {...listeners}
        />

        {isCover && (
          <span className="absolute left-3 top-3 inline-flex min-h-6 items-center rounded-full bg-cta px-2.5 py-1 text-[11px] font-medium text-cta-foreground">
            {t('cover')}
          </span>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className="absolute right-2 top-2 flex h-12 w-12 items-center justify-center rounded-full bg-card text-destructive transition-colors hover:bg-secondary"
          aria-label={t('ariaRemove')}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export function ProductPhotosField({
  name = 'productPhotos',
  brandId,
  defaultPhotos,
}: ProductPhotosFieldProps) {
  const t = useTranslations('forms.photos')
  const [photos, setPhotos] = useState<ProductPhoto[]>(() =>
    defaultPhotos.map((url) => ({
      id: crypto.randomUUID(),
      url,
    }))
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = photos.findIndex((photo) => photo.id === active.id)
    const newIndex = photos.findIndex((photo) => photo.id === over.id)

    if (oldIndex < 0 || newIndex < 0) return

    setPhotos((currentPhotos) => arrayMove(currentPhotos, oldIndex, newIndex))
  }

  const handleUpload = (url: string) => {
    setPhotos((currentPhotos) => [
      ...currentPhotos,
      { id: crypto.randomUUID(), url },
    ])
  }

  const handleRemove = (id: string) => {
    setPhotos((currentPhotos) =>
      currentPhotos.filter((photo) => photo.id !== id)
    )
  }

  return (
    <div className="space-y-4">
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(photos.map((photo) => photo.url))}
      />

      <p className="text-sm text-muted-foreground">
        {t('reorderHint')}
      </p>

      {photos.length > 0 && (
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={photos.map((photo) => photo.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo, index) => (
                <SortablePhoto
                  key={photo.id}
                  photo={photo}
                  isCover={index === 0}
                  onRemove={() => handleRemove(photo.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <ImageUploader
        mode="multi"
        bucket="brand-images"
        path={`brands/${brandId}/photos`}
        value={[]}
        onUpload={handleUpload}
        maxFiles={Math.max(0, 6 - photos.length)}
      />
    </div>
  )
}
