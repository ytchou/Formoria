export function EmptyValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

export function display(value: string | number | null | undefined, fallback: string) {
  return value === null || value === undefined || value === ''
    ? <EmptyValue>{fallback}</EmptyValue>
    : String(value)
}
