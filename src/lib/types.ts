export type LayoutPara = { lines: string[]; x0: number; x1: number; y0: number; y1: number; lineH: number }
export type Layout = { paras: LayoutPara[]; width: number; height: number }
export type Label = { label: string; probability: number }
export type LowWord = { text: string; confidence: number }
export type ScanRecord = {
  id: string; name: string; text: string; date: string; preview: string; confidence?: number
  ocrText?: string; layout?: Layout; labels?: Label[]; lowWords?: LowWord[]
}
