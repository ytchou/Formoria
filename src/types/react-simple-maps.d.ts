declare module 'react-simple-maps' {
  import type { ReactNode, SVGProps } from 'react'

  export interface GeoFeature {
    rsmKey: string
    properties: Record<string, unknown>
  }

  export interface ComposableMapProps extends SVGProps<SVGSVGElement> {
    projection?: string
    projectionConfig?: Record<string, unknown>
    children?: ReactNode
  }

  export interface GeographiesProps {
    geography: string
    children: (props: { geographies: GeoFeature[] }) => ReactNode
  }

  export interface GeographyProps extends SVGProps<SVGPathElement> {
    geography: GeoFeature
    style?: {
      default?: SVGProps<SVGPathElement>['style']
      hover?: SVGProps<SVGPathElement>['style']
      pressed?: SVGProps<SVGPathElement>['style']
    }
  }

  export function ComposableMap(props: ComposableMapProps): JSX.Element
  export function Geographies(props: GeographiesProps): JSX.Element
  export function Geography(props: GeographyProps): JSX.Element
}
