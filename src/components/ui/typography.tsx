import { createElement, type HTMLAttributes, type ReactNode } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { textStyles } from './text-styles'

type TypographyElement =
  | 'p'
  | 'span'
  | 'div'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'dt'
  | 'dd'
  | 'label'

type TypographyProps = HTMLAttributes<HTMLElement> & {
  as?: TypographyElement
  balance?: boolean
  children?: ReactNode
  pretty?: boolean
  variant?: VariantProps<typeof textStyles>['variant']
}

export function Typography({
  as = 'p',
  balance = false,
  children,
  className,
  pretty = false,
  variant = 'body',
  ...props
}: TypographyProps) {
  return createElement(
    as,
    {
      ...props,
      className: cn(
        textStyles({ variant }),
        balance && 'text-balance',
        pretty && 'text-pretty',
        className,
      ),
    },
    children,
  )
}
