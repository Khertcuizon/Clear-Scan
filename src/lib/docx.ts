import { AlignmentType, Document, ImageRun, Packer, PageOrientation, Paragraph, TextRun } from 'docx'
import type { Label, Layout } from './types'

export type ExportInput = {
  text: string; originalText: string; layout?: Layout; labels?: Label[]
  image?: string; includeImage: boolean; name: string
}

const MARGIN = 1134 // 2 cm in twips
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

async function pictureRun(src: string, maxWidthPx: number): Promise<ImageRun> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error('Could not read the image.')); el.src = src
  })
  const scale = Math.min(1, 1400 / img.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the image.')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const data = new Uint8Array(await (await fetch(canvas.toDataURL('image/jpeg', 0.88))).arrayBuffer())
  const width = Math.min(maxWidthPx, canvas.width)
  return new ImageRun({ type: 'jpg', data, transformation: { width, height: Math.round(canvas.height * width / canvas.width) } })
}

function layoutParagraphs(layout: Layout, contentTwips: number): Paragraph[] {
  const ptPerPx = (contentTwips / 20) / layout.width
  let previousBottom = 0
  return layout.paras.map(p => {
    const fontPt = clamp(p.lineH * ptPerPx / 1.25, 8, 40)
    const gapLeft = p.x0, gapRight = layout.width - p.x1
    const centered = gapLeft > layout.width * 0.08 && Math.abs(gapLeft - gapRight) < layout.width * 0.04
    const right = !centered && gapLeft > layout.width * 0.45 && gapRight < layout.width * 0.08
    const before = clamp((p.y0 - previousBottom) * ptPerPx * 20, 0, 720)
    previousBottom = p.y1
    return new Paragraph({
      alignment: centered ? AlignmentType.CENTER : right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { before: Math.round(before), after: 0 },
      indent: { left: centered || right ? 0 : Math.round(clamp(p.x0 * ptPerPx * 20, 0, contentTwips * 0.6)) },
      children: p.lines.map((line, i) => new TextRun({ text: line, font: 'Times New Roman', size: Math.round(fontPt * 2), break: i ? 1 : undefined })),
    })
  })
}

function plainParagraphs(text: string): Paragraph[] {
  return text.split(/\n{2,}/).filter(block => block.trim()).map(block => new Paragraph({
    spacing: { after: 160 },
    children: block.split('\n').map((line, i) => new TextRun({ text: line, font: 'Times New Roman', size: 24, break: i ? 1 : undefined })),
  }))
}

export async function exportDocx(input: ExportInput): Promise<void> {
  const { text, originalText, layout, labels, image, name } = input
  const landscape = !!layout && layout.width > layout.height
  const contentTwips = (landscape ? 16838 : 11906) - MARGIN * 2
  const children: Paragraph[] = []
  const objectOnly = !text.trim() && !!labels?.length

  if (image && (input.includeImage || objectOnly)) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [await pictureRun(image, contentTwips / 15)] }))
  }
  if (objectOnly && labels) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: 'Objects identified', font: 'Times New Roman', bold: true, size: 28 })],
    }))
    labels.forEach(l => children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: l.label, font: 'Times New Roman', size: 24 })],
    })))
  } else if (layout && text.trim() === originalText.trim()) {
    children.push(...layoutParagraphs(layout, contentTwips))
  } else {
    children.push(...plainParagraphs(text))
  }

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      children,
    }],
  })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url
  link.download = `${name.replace(/\.[^/.]+$/, '') || 'clearscan'}.docx`; link.click()
  URL.revokeObjectURL(url)
}
