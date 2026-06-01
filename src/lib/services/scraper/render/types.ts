export interface RenderResult {
  html: string
  finalUrl: string
  status: number
}
export interface RenderProvider {
  fetchRendered(url: string): Promise<RenderResult>
}
