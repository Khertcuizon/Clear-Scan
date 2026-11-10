import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

export async function extractPdfPageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent()
  const viewport = page.getViewport({ scale: 1 })
  const items = content.items
    .filter((item): item is TextItem => 'str' in item && item.str.trim().length > 0)
    .map(item => ({
      text: item.str,
      x: item.transform[4],
      y: viewport.height - item.transform[5],
      width: item.width,
      height: Math.max(1, Math.hypot(item.transform[2], item.transform[3])),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const rows: { y: number; height: number; items: typeof items }[] = []
  for (const item of items) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= Math.max(2, item.height * 0.3))
    if (row) {
      row.items.push(item)
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length
      row.height = Math.max(row.height, item.height)
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] })
    }
  }

  rows.sort((a, b) => a.y - b.y)
  return rows.map((row, rowIndex) => {
    row.items.sort((a, b) => a.x - b.x)
    const line = row.items.reduce((value, item, itemIndex, lineItems) => {
      if (itemIndex === 0) return item.text
      const previous = lineItems[itemIndex - 1]
      const gap = item.x - (previous.x + previous.width)
      const needsSpace = gap > item.height * 0.15 && !/\s$/.test(value) && !/^\s/.test(item.text)
      return `${value}${needsSpace ? ' ' : ''}${item.text}`
    }, '')
    const previous = rows[rowIndex - 1]
    return `${previous && row.y - previous.y > Math.max(row.height, previous.height) * 1.65 ? '\n' : ''}${line}`
  }).join('\n').trim()
}

export async function renderPdfPage(page: PDFPageProxy, maxDimension = 2400): Promise<HTMLCanvasElement> {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(2, maxDimension / Math.max(baseViewport.width, baseViewport.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not render the PDF page.')
  await page.render({ canvasContext: context, viewport }).promise
  return canvas
}
