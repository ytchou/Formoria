'use client'

export type DiffField = {
  field: string
  fieldKey: string
  currentValue: string | null
  proposedValue: string | null
  changed: boolean
  isImage?: boolean
}

export function computeDiffFields(
  currentBrand: Record<string, unknown>,
  proposedData: Record<string, unknown>
): DiffField[] {
  const FIELD_LABELS: Record<string, string> = {
    name: '品牌名稱',
    description: '品牌描述',
    heroImageUrl: '封面圖片',
    category: '類別',
    contactEmail: '聯絡信箱',
    foundingYear: '創立年份',
    customerVoices: '顧客心聲',
  }

  const IMAGE_FIELDS = new Set(['heroImageUrl'])

  return Object.keys(proposedData).map((key) => {
    const currentValue =
      currentBrand[key] != null ? String(currentBrand[key]) : null
    const proposedValue =
      proposedData[key] != null ? String(proposedData[key]) : null

    return {
      field: FIELD_LABELS[key] ?? key,
      fieldKey: key,
      currentValue,
      proposedValue,
      changed: currentValue !== proposedValue,
      isImage: IMAGE_FIELDS.has(key),
    }
  })
}

function ValueBox({
  value,
  isImage,
  highlighted,
}: {
  value: string | null
  isImage?: boolean
  highlighted?: boolean
}) {
  const base = 'rounded-lg border p-3'
  const style = highlighted
    ? `${base} bg-[var(--verified-green-bg)] border-[var(--primary-light)]`
    : `${base} border-[var(--border)] bg-white`

  if (isImage) {
    return (
      <div
        className={`${style} flex items-center justify-center`}
        style={{ height: 140 }}
      >
        <span className="text-xs text-muted-foreground">Image</span>
      </div>
    )
  }

  return (
    <div className={style}>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

export function EditDiffView({ fields }: { fields: DiffField[] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-secondary px-3 py-2 text-center text-xs font-semibold">
          目前版本
        </div>
        <div
          className="rounded-lg px-3 py-2 text-center text-xs font-semibold"
          style={{ background: 'var(--verified-green-bg)' }}
        >
          提案修改
        </div>
      </div>

      {fields.map((f) => (
        <div key={f.fieldKey} className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">
            {f.field}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <ValueBox value={f.currentValue} isImage={f.isImage} />
            <ValueBox
              value={f.proposedValue}
              isImage={f.isImage}
              highlighted={f.changed}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
