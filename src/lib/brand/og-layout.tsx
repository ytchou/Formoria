import type { ReactNode } from 'react'

type OgLayoutProps = {
  backgroundColor: string
  children: ReactNode
  leftStripe?: ReactNode
  header?: ReactNode
  headerStyle?: {
    display: 'flex'
    alignItems: 'center'
    color: string
    fontFamily: string
    marginBottom?: number
    position?: 'absolute'
    top?: number
    left?: number
  }
  contentStyle: {
    display: 'flex'
    flexDirection: 'column'
    justifyContent: 'center'
    alignItems: 'flex-start' | 'center'
    width: '100%'
    height: '100%'
    padding: string
    textAlign?: 'left' | 'center'
  }
}

export function OgLayout({
  backgroundColor,
  children,
  leftStripe,
  header,
  headerStyle,
  contentStyle,
}: OgLayoutProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        backgroundColor,
        position: 'relative',
      }}
    >
      {leftStripe}
      {header && headerStyle ? <div style={headerStyle}>{header}</div> : null}
      <div style={contentStyle}>{children}</div>
    </div>
  )
}
