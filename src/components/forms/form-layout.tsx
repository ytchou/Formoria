import type {
  ComponentPropsWithoutRef,
  FormHTMLAttributes,
  ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type StandardFormProps = FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode
}

type StandardFormSectionProps = ComponentPropsWithoutRef<'section'> & {
  children: ReactNode
}

type StandardFormStackProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode
}

const panelClassName = 'rounded-xl border border-border bg-card p-8 shadow-sm'
const stackClassName = 'flex flex-col gap-5'

export function StandardForm({
  className,
  children,
  ...props
}: StandardFormProps) {
  return (
    <form className={cn(panelClassName, className)} {...props}>
      {children}
    </form>
  )
}

export function StandardFormSection({
  className,
  children,
  ...props
}: StandardFormSectionProps) {
  return (
    <section className={cn(panelClassName, className)} {...props}>
      {children}
    </section>
  )
}

export function StandardFormStack({
  className,
  children,
  ...props
}: StandardFormStackProps) {
  return (
    <div className={cn(stackClassName, className)} {...props}>
      {children}
    </div>
  )
}
