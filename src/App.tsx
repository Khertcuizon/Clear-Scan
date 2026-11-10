import { useEffect, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'
import {
  ScanText, Upload, Camera, FileText, Clock3, Copy, Download, Trash2, Search, Check,
  LoaderCircle, Image as ImageIcon, X, ScanLine, Menu, PanelLeftClose, Plus, Minus,
} from 'lucide-react'
import { identifyImage } from './lib/identify'
import { exportDocx } from './lib/docx'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Label, Layout, ScanRecord } from './lib/types'

const STORAGE_KEY = 'clearscan-history-v1'
const SIZE_KEY = 'clearscan-text-size'
const AUTO_OCR_LANGUAGE = 'eng+spa+fra+deu+ita+por+nld+fil'
const HISTORY_RANGES = [
  { value: 'recent', label: 'Recent scans' },
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: '2months', label: 'Last 2 months' },
  { value: '3months', label: 'Last 3 months' },
  { value: '6months', label: 'Last 6 months' },
  { value: '9months', label: 'Last 9 months' },
  { value: 'year', label: 'Last year' },
  { value: 'custom', label: 'Custom date range' },
  { value: 'all', label: 'All time' },
] as const
const OCR_LANGUAGES = [
  { code: 'auto', name: 'Auto (all supported languages)' },
  { code: 'eng', name: 'English' }, { code: 'spa', name: 'Spanish' }, { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' }, { code: 'ita', name: 'Italian' }, { code: 'por', name: 'Portuguese' },
  { code: 'nld', name: 'Dutch' }, { code: 'fil', name: 'Filipino' },
]

function readHistory(): ScanRecord[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as ScanRecord[] } catch { return [] }
}

function hasReadableText(words: { text: string; confidence: number }[], pageConfidence: number): boolean {
  const tokens = words.flatMap(word => {
    if (word.confidence < 65) return []
    const text = (word.text.match(/[\p{L}\p{N}]+/gu) ?? []).join('')
    if (!text) return []
    const lettersOnly = /^\p{L}+$/u.test(text)
    const digitsOnly = /^\p{N}+$/u.test(text)
    const meaningful = (lettersOnly && text.length >= 2)
      || (digitsOnly && text.length >= 3)
      || (!lettersOnly && !digitsOnly && text.length >= 4)
    return meaningful ? [{ text, confidence: word.confidence }] : []
  })

  if (tokens.length >= 2 && tokens.reduce((length, token) => length + token.text.length, 0) >= 5) {
    return pageConfidence >= 50
  }

  return tokens.length === 1
    && tokens[0].confidence >= 80
    && pageConfidence >= 65
    && tokens[0].text.length >= 3
}

function monthsAgo(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() - months)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDay))
  return result
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode the selected image.'))
    image.src = source
  })
}

async function prepareImageForOcr(source: string, enhance: boolean): Promise<HTMLCanvasElement> {
  const image = await loadImage(source)
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  const target = enhance ? Math.min(3200, longest < 1600 ? longest * 1.5 : longest) : Math.min(3200, longest)
  const scale = target / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not prepare the image for OCR.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  if (enhance) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114
      const value = Math.max(0, Math.min(255, (gray - 128) * 1.15 + 128))
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value
    }
    context.putImageData(pixels, 0, 0)
  }
  return canvas
}

export default function App() {
  const [image, setImage] = useState('')
  const [fileName, setFileName] = useState('')
  const [recognizedText, setRecognizedText] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [layout, setLayout] = useState<Layout | undefined>()
  const [labels, setLabels] = useState<Label[] | null>(null)
  const [history, setHistory] = useState<ScanRecord[]>(readHistory)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [language, setLanguage] = useState('eng')
  const [enhanceImage, setEnhanceImage] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [includeImage, setIncludeImage] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [textSize, setTextSize] = useState(() => Number(localStorage.getItem(SIZE_KEY)) || 20)
  const [query, setQuery] = useState('')
  const [historyRange, setHistoryRange] = useState<string>('recent')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const [activeTab, setActiveTab] = useState<'scanner' | 'history'>('scanner')
  const [notice, setNotice] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanControllerRef = useRef<AbortController | null>(null)
  const scanWorkerRef = useRef<Awaited<ReturnType<typeof createWorker>> | null>(null)
  const scanPdfRef = useRef<PDFDocumentProxy | null>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)) }
    catch { setNotice('Browser storage is full. Delete old scans to save new ones.') }
  }, [history])
  useEffect(() => { localStorage.setItem(SIZE_KEY, String(textSize)) }, [textSize])
  useEffect(() => () => { streamRef.current?.getTracks().forEach(track => track.stop()) }, [])

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 3000) }

  function resetResult() {
    setRecognizedText(''); setOcrText(''); setLayout(undefined); setLabels(null)
    setProgress(0); setStatus('')
  }

  function cancelScan() {
    if (!scanning || cancelRequested) return
    setCancelRequested(true)
    setStatus('Cancelling scan...')
    scanControllerRef.current?.abort()

    const worker = scanWorkerRef.current
    scanWorkerRef.current = null
    if (worker) void worker.terminate().catch(error => console.error('Could not stop OCR worker.', error))

    const pdf = scanPdfRef.current
    scanPdfRef.current = null
    if (pdf) void pdf.destroy().catch(error => console.error('Could not close cancelled PDF.', error))
  }

  function selectImage(file?: File) {
    if (!file || busy) return
    if (!file.type.startsWith('image/')) { showNotice('Please select an image file.'); return }
    if (file.size > 15 * 1024 * 1024) { showNotice('Image must be smaller than 15 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setImage(String(reader.result || '')); setPdfFile(null); setFileName(file.name); resetResult(); setActiveTab('scanner') }
    reader.onerror = () => showNotice('Could not read this image. Please try another file.')
    reader.readAsDataURL(file)
  }

  async function selectPdf(file?: File) {
    if (!file || busy) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showNotice('Please select a PDF file.')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      showNotice('PDF must be smaller than 50 MB.')
      return
    }
    setBusy(true)
    resetResult()
    setStatus('Loading PDF preview...')
    let pdf: PDFDocumentProxy | undefined
    try {
      const { openPdf, renderPdfPage } = await import('./lib/pdf')
      pdf = await openPdf(file)
      if (pdf.numPages < 1) throw new Error('The PDF has no pages.')
      const canvas = await renderPdfPage(await pdf.getPage(1), 1200)
      setImage(canvas.toDataURL('image/jpeg', 0.88))
      setPdfFile(file)
      setFileName(file.name)
      setActiveTab('scanner')
    } catch (error) {
      console.error(error)
      setImage('')
      setPdfFile(null)
      setFileName('')
      showNotice('Could not open this PDF. It may be damaged or password-protected.')
    } finally {
      if (pdf) {
        try { await pdf.destroy() } catch (error) { console.error('Could not close PDF preview.', error) }
      }
      setBusy(false)
      setStatus('')
    }
  }

  function selectFile(file?: File) {
    if (!file) return
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) void selectPdf(file)
    else selectImage(file)
  }

  async function startScan() {
    if ((!image && !pdfFile) || busy) return
    setBusy(true); setScanning(true); resetResult(); setStatus(pdfFile ? 'Opening PDF...' : 'Preparing image...')
    setCancelRequested(false)
    const controller = new AbortController()
    scanControllerRef.current = controller
    const ensureActive = () => {
      if (controller.signal.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
    }
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined
    let pdfDocument: PDFDocumentProxy | undefined
    const ocrLanguage = language === 'auto' ? AUTO_OCR_LANGUAGE : language
    try {
      if (pdfFile) {
        const { extractPdfPageText, openPdf, renderPdfPage } = await import('./lib/pdf')
        const pdf = pdfDocument = await openPdf(pdfFile)
        scanPdfRef.current = pdf
        ensureActive()
        const pageTexts: (string | null)[] = []
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          ensureActive()
          setStatus(`Extracting PDF text (${pageNumber}/${pdf.numPages})...`)
          setProgress(Math.round((pageNumber / pdf.numPages) * 35))
          const page = await pdf.getPage(pageNumber)
          const text = await extractPdfPageText(page)
          pageTexts.push(text.trim().length >= 20 ? text : null)
        }

        const pagesNeedingOcr = pageTexts.reduce<number[]>((pages, text, index) => {
          if (text === null) pages.push(index + 1)
          return pages
        }, [])
        if (pagesNeedingOcr.length) {
          setStatus('Loading OCR engine...')
          worker = await createWorker(ocrLanguage, 1, {
            logger: message => {
              if (!controller.signal.aborted && message.status === 'recognizing text') setStatus('Reading scanned PDF pages...')
            },
          })
          scanWorkerRef.current = worker
          ensureActive()
          for (let index = 0; index < pagesNeedingOcr.length; index++) {
            ensureActive()
            const pageNumber = pagesNeedingOcr[index]
            setStatus(`Reading scanned PDF page ${pageNumber}/${pdf.numPages}...`)
            const page = await pdf.getPage(pageNumber)
            const canvas = await renderPdfPage(page)
            if (enhanceImage) {
              const context = canvas.getContext('2d', { willReadFrequently: true })
              if (!context) throw new Error('Could not enhance the PDF page.')
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
              for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
                const gray = pixels.data[pixel] * 0.299 + pixels.data[pixel + 1] * 0.587 + pixels.data[pixel + 2] * 0.114
                const value = Math.max(0, Math.min(255, (gray - 128) * 1.15 + 128))
                pixels.data[pixel] = pixels.data[pixel + 1] = pixels.data[pixel + 2] = value
              }
              context.putImageData(pixels, 0, 0)
            }
            const { data } = await worker.recognize(canvas)
            ensureActive()
            pageTexts[pageNumber - 1] = data.text.trim()
            setProgress(35 + Math.round(((index + 1) / pagesNeedingOcr.length) * 65))
          }
        }

        const text = pageTexts.map(page => page ?? '').join('\n\n').trim()
        ensureActive()
        if (!text) {
          setStatus('No readable text found')
          showNotice('No text was found in this PDF. Try a clearer or higher-resolution scan.')
          return
        }
        setRecognizedText(text)
        setOcrText(text)
        setLayout(undefined)
        setLabels(null)
        setStatus('Done')
        setProgress(100)
        const record: ScanRecord = {
          id: crypto.randomUUID(), name: fileName || 'Scanned PDF', text, ocrText: text,
          date: new Date().toISOString(), preview: image,
        }
        setHistory(current => [record, ...current].slice(0, 50))
        return
      }

      const canvas = await prepareImageForOcr(image, enhanceImage)
      ensureActive()
      setStatus('Loading OCR engine...')
      worker = await createWorker(ocrLanguage, 1, {
        logger: message => {
          if (!controller.signal.aborted && message.status === 'recognizing text') { setStatus('Reading text...'); setProgress(Math.round(message.progress * 90)) }
        },
      })
      scanWorkerRef.current = worker
      ensureActive()
      const { data } = await worker.recognize(canvas)
      ensureActive()
      const words = data.words ?? []
      const hasText = hasReadableText(words, data.confidence)
      let record: ScanRecord | null = null
      let found: Label[] | null = null
      let identificationFailed = false

      if (!hasText) {
        setStatus('Checking objects...')
        try {
          found = await identifyImage(await loadImage(image))
          ensureActive()
          setLabels(found.length ? found : null)
        } catch (error) {
          if (controller.signal.aborted) throw error
          console.error(error)
          identificationFailed = true
          setStatus('Could not identify the picture')
          showNotice('Picture identification failed. Check your internet connection and try again.')
        }
      }

      ensureActive()

      if (hasText) {
        const text = data.text.trim()
        const paras = (data.paragraphs ?? []).map(p => {
          const lines = p.lines.map(l => l.text.replace(/\s+$/, '')).filter(Boolean)
          const heights = p.lines.map(l => l.bbox.y1 - l.bbox.y0)
          return { lines, x0: p.bbox.x0, x1: p.bbox.x1, y0: p.bbox.y0, y1: p.bbox.y1,
            lineH: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 20 }
        }).filter(p => p.lines.length)
        const pageLayout: Layout = { paras, width: canvas.width, height: canvas.height }
        const score = Math.round(data.confidence)
        setRecognizedText(text); setOcrText(text); setLayout(pageLayout)
        record = { id: crypto.randomUUID(), name: fileName || 'Scanned image', text, ocrText: text, layout: pageLayout,
          confidence: score, date: new Date().toISOString(), preview: image }
        setStatus('Done')
      } else {
        if (found?.length) {
          record = { id: crypto.randomUUID(), name: fileName || 'Scanned image', text: '', labels: found,
            date: new Date().toISOString(), preview: image }
          setStatus('Done')
        } else if (!identificationFailed) {
          setLabels(null)
          setStatus('No objects detected')
          showNotice('No readable text or recognizable objects were found. Try a clearer picture.')
        }
      }
      setProgress(100)
      if (record) { const saved = record; setHistory(current => [saved, ...current].slice(0, 50)) }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setStatus('Scan cancelled')
        setProgress(0)
      } else {
        console.error(error)
        setStatus('Scan failed')
        showNotice('Could not process this image. Try a clearer picture.')
      }
    } finally {
      try {
        if (worker && scanWorkerRef.current === worker) {
          scanWorkerRef.current = null
          await worker.terminate()
        }
      } catch (error) {
        console.error('Could not close OCR worker.', error)
      } finally {
        if (pdfDocument && scanPdfRef.current === pdfDocument) {
          scanPdfRef.current = null
          try { await pdfDocument.destroy() } catch (error) { console.error('Could not close PDF document.', error) }
        }
        if (scanControllerRef.current === controller) scanControllerRef.current = null
        setScanning(false)
        setCancelRequested(false)
        setBusy(false)
      }
    }
  }

  async function openCamera() {
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError('Camera is unavailable. Use HTTPS or localhost, or upload an image.'); setCameraOpen(true); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream; setCameraOpen(true)
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 50)
    } catch { setCameraError('Camera permission was denied or no camera was found.'); setCameraOpen(true) }
  }

  function capturePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    setImage(canvas.toDataURL('image/png')); setFileName(`camera-scan-${new Date().toISOString().slice(0, 10)}.png`)
    resetResult(); closeCamera(); setActiveTab('scanner')
  }

  function closeCamera() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setCameraOpen(false) }

  async function copyText() {
    if (!recognizedText.trim()) return
    try {
      const escaped = recognizedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html = `<div style="font-family:'Times New Roman',serif;white-space:pre-wrap">${escaped.replace(/\n/g, '<br>')}</div>`
      if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([recognizedText], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })])
      } else {
        await navigator.clipboard.writeText(recognizedText)
      }
      showNotice('Copied with text formatting.')
    } catch (error) {
      console.error(error)
      try {
        await navigator.clipboard.writeText(recognizedText)
        showNotice('Copied as plain text.')
      } catch (fallbackError) {
        console.error(fallbackError)
        showNotice('Clipboard is unavailable in this browser.')
      }
    }
  }

  function downloadText() {
    if (!recognizedText.trim()) return
    const url = URL.createObjectURL(new Blob([recognizedText], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url
    link.download = `${(fileName || 'clearscan').replace(/\.[^/.]+$/, '')}.txt`; link.click(); URL.revokeObjectURL(url)
  }

  async function downloadDocx() {
    if (exporting) return
    setExporting(true)
    try {
      await exportDocx({ text: recognizedText, originalText: ocrText, layout, labels: labels ?? undefined, image, includeImage, name: fileName })
    } catch (error) { console.error(error); showNotice('Could not create the Word file.') }
    finally { setExporting(false) }
  }

  function removeRecord(id: string) { setHistory(items => items.filter(item => item.id !== id)); showNotice('Deleted.') }
  function clearHistory() {
    if (!history.length || !window.confirm(`Clear all ${history.length} saved scans? This cannot be undone.`)) return
    setHistory([])
    showNotice('All scan history cleared.')
  }
  function loadRecord(record: ScanRecord) {
    setImage(record.preview); setFileName(record.name); setRecognizedText(record.text); setOcrText(record.ocrText ?? record.text)
    setLayout(record.layout); setLabels(record.labels ?? null)
    setStatus(''); setProgress(0); setActiveTab('scanner')
  }

  const q = query.toLowerCase()
  const now = new Date()
  const rangeStart = new Date(now)
  if (historyRange === 'day') rangeStart.setHours(0, 0, 0, 0)
  else if (historyRange === 'week') rangeStart.setDate(rangeStart.getDate() - 7)
  else if (historyRange === 'month') rangeStart.setDate(rangeStart.getDate() - 30)
  else if (historyRange === '2months') rangeStart.setTime(monthsAgo(now, 2).getTime())
  else if (historyRange === '3months') rangeStart.setTime(monthsAgo(now, 3).getTime())
  else if (historyRange === '6months') rangeStart.setTime(monthsAgo(now, 6).getTime())
  else if (historyRange === '9months') rangeStart.setTime(monthsAgo(now, 9).getTime())
  else if (historyRange === 'year') rangeStart.setTime(monthsAgo(now, 12).getTime())
  const customStart = historyFrom ? new Date(`${historyFrom}T00:00:00`) : null
  const customEnd = historyTo ? new Date(`${historyTo}T23:59:59.999`) : null
  const searchedHistory = history.filter(r => `${r.name} ${r.text} ${r.labels?.map(l => l.label).join(' ') ?? ''}`.toLowerCase().includes(q))
  const sortedHistory = searchedHistory.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const filteredHistory = sortedHistory.filter((record, index) => {
    if (historyRange === 'recent') return index < 10
    const time = Date.parse(record.date)
    if (!Number.isFinite(time)) return false
    if (historyRange === 'all') return true
    if (historyRange === 'custom') {
      return (!customStart || time >= customStart.getTime()) && (!customEnd || time <= customEnd.getTime())
    }
    return time >= rangeStart.getTime()
  })
  const showLabels = !!labels?.length && !recognizedText.trim()
  const go = (tab: 'scanner' | 'history') => { setActiveTab(tab); setMobileMenu(false) }

  return <div className="app-shell">
    <div className="bg-orbs" aria-hidden="true"><span/><span/><span/></div>
    <button className="icon-button menu-button" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={22}/></button>
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="brand"><img className="brand-logo" src="/clearscan-logo-full.png" alt="ClearScan"/><button className="mobile-close icon-button" onClick={() => setMobileMenu(false)} aria-label="Close menu"><PanelLeftClose size={20}/></button></div>
      <button className={`nav-item ${activeTab === 'scanner' ? 'active' : ''}`} onClick={() => go('scanner')}><ScanLine size={20}/> <span>Scan</span></button>
      <button className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => go('history')}><Clock3 size={20}/> <span>History</span><span className="nav-count">{history.length}</span></button>
    </aside>

    <main className="main-area"><div className="page-content">
      {activeTab === 'scanner' ? <>
        <div className="page-heading"><h1>Scan</h1></div>
        <div className="workspace-grid">
          <section className="panel upload-panel">
            <div className={`drop-zone ${image ? 'has-image' : ''} ${scanning ? 'is-scanning' : ''}`} role={image ? undefined : 'button'} tabIndex={image ? undefined : 0}
              onClick={() => { if (!image) inputRef.current?.click() }}
              onKeyDown={event => { if (!image && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click() }}
              onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files?.[0]) }}>
              {image ? <><img className="preview-image" src={image} alt="Selected document preview"/>{scanning && <div className="scan-sweep" aria-hidden="true"><span className="scan-beam"/></div>}<div className="image-overlay"><span><ImageIcon size={16}/> {fileName}</span><button disabled={scanning} onClick={() => { setImage(''); setPdfFile(null); setFileName(''); resetResult() }} aria-label="Remove image"><X size={18}/></button></div></>
                : <div className="upload-empty"><div className="upload-icon"><Upload size={28}/></div><strong>Drop an image or PDF here</strong><span className="file-hint">PNG · JPG · WEBP · PDF</span></div>}
            </div>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { selectImage(event.target.files?.[0]); event.target.value = '' }}/>
            <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={event => { void selectPdf(event.target.files?.[0]); event.target.value = '' }}/>
            <div className="upload-actions">
              <button className="secondary-button" onClick={() => inputRef.current?.click()}><ImageIcon size={18}/> Image</button>
              <button className="secondary-button" onClick={() => pdfInputRef.current?.click()}><FileText size={18}/> PDF</button>
              <button className="secondary-button" onClick={openCamera}><Camera size={18}/> Camera</button>
            </div>
            <div className="ocr-settings">
              <label className="language-setting">Language
                <select value={language} onChange={event => setLanguage(event.target.value)} disabled={busy}>
                  {OCR_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
                {language === 'auto' && <span className="language-note">Auto reads all supported languages and may take longer on the first scan.</span>}
              </label>
            </div>
            <div className="check-row">
              <label className="enhance-setting"><input type="checkbox" checked={enhanceImage} onChange={event => setEnhanceImage(event.target.checked)} disabled={busy}/> Enhance image</label>
              <label className="enhance-setting"><input type="checkbox" checked={includeImage} onChange={event => setIncludeImage(event.target.checked)}/> Picture in Word file</label>
            </div>
            {scanning
              ? <button className="cancel-scan-button" disabled={cancelRequested} onClick={cancelScan}><X size={18}/>{cancelRequested ? 'Cancelling...' : 'Cancel scan'}</button>
              : <button className="primary-button scan-button" disabled={!image || busy} onClick={startScan}>{busy ? <><LoaderCircle className="spin" size={20}/> Working...</> : <><ScanText size={20}/> Scan</>}</button>}
            {(busy || status) && <div className="progress-wrap"><div className="progress-label"><span>{status}</span>{busy && <b>{progress}%</b>}</div>{busy && <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }}/></div>}</div>}
          </section>

          <section className="panel result-panel">
            {recognizedText.trim() && <div className="result-toolbar">
              <div className="size-controls" role="group" aria-label="Text size">
                <button className="tool-button" onClick={() => setTextSize(s => Math.max(16, s - 2))} aria-label="Smaller text"><Minus size={16}/></button>
                <span>{textSize}px</span>
                <button className="tool-button" onClick={() => setTextSize(s => Math.min(34, s + 2))} aria-label="Larger text"><Plus size={16}/></button>
              </div>
              <div className="result-actions">
                {recognizedText.trim() && <>
                  <button className="tool-button" onClick={copyText}><Copy size={17}/> Copy</button>
                  <button className="tool-button" onClick={downloadText}><Download size={17}/> TXT</button>
                </>}
                <button className="tool-button" disabled={exporting} onClick={downloadDocx}>{exporting ? <LoaderCircle className="spin" size={17}/> : <FileText size={17}/>} DOCX</button>
              </div>
            </div>}
            {showLabels && labels && <div className="object-results">
              <ul className="object-names">
                {labels.map(item => <li key={item.label}>{item.label}</li>)}
              </ul>
            </div>}
            {recognizedText.trim() && <textarea className="text-output" style={{ fontSize: textSize }} value={recognizedText} onChange={event => setRecognizedText(event.target.value)} placeholder="Scanned text appears here" spellCheck={false}/>}
          </section>
        </div>
      </> : <>
        <div className="page-heading"><h1>History</h1></div>
        <section className="panel history-panel"><div className="history-top"><h2>{history.length} saved</h2><div className="history-header-actions"><div className="search-box"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search"/></div><button className="clear-history-button" disabled={!history.length} onClick={clearHistory}><Trash2 size={16}/> Clear all</button></div></div>
          <div className="history-filters">
            <label className="history-date-filter">Date range
              <select value={historyRange} onChange={event => setHistoryRange(event.target.value)}>
                {HISTORY_RANGES.map(range => <option key={range.value} value={range.value}>{range.label}</option>)}
              </select>
            </label>
            {historyRange === 'custom' && <div className="history-custom-dates">
              <label>From<input type="date" value={historyFrom} max={historyTo || undefined} onChange={event => setHistoryFrom(event.target.value)}/></label>
              <label>To<input type="date" value={historyTo} min={historyFrom || undefined} onChange={event => setHistoryTo(event.target.value)}/></label>
            </div>}
            <span className="history-result-count">Showing {filteredHistory.length} of {history.length}</span>
          </div>
          {filteredHistory.length ? <div className="history-list">{filteredHistory.map(record => <div className="history-item" key={record.id}><img src={record.preview} alt=""/><div className="history-info"><strong>{record.name}</strong><span>{new Date(record.date).toLocaleString()}</span><p>{record.text ? record.text.slice(0, 110).replace(/\s+/g, ' ') + (record.text.length > 110 ? '...' : '') : record.labels?.[0]?.label ?? ''}</p></div><div className="history-item-actions"><button className="tool-button" onClick={() => loadRecord(record)}><FileText size={17}/> Open</button><button className="icon-button danger" onClick={() => removeRecord(record.id)} aria-label="Delete scan"><Trash2 size={18}/></button></div></div>)}</div>
            : <div className="history-empty"><div className="upload-icon"><Clock3 size={26}/></div><strong>{!history.length ? 'Nothing saved yet' : query ? 'No matches' : historyRange === 'custom' ? 'No scans in this date range' : 'No scans in this period'}</strong><button className="secondary-button" onClick={() => { go('scanner'); setQuery('') }}>Scan</button></div>}
        </section>
      </>}
    </div></main>

    {cameraOpen && <div className="modal-backdrop" onClick={closeCamera}><div className="camera-modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><h2>Camera</h2><button className="icon-button" onClick={closeCamera} aria-label="Close camera"><X size={20}/></button></div>{cameraError ? <div className="camera-error"><Camera size={30}/><p>{cameraError}</p></div> : <video ref={videoRef} autoPlay playsInline muted className="camera-video"/>}<div className="camera-controls"><button className="secondary-button" onClick={closeCamera}>Cancel</button><button className="primary-button" disabled={!!cameraError} onClick={capturePhoto}><Camera size={18}/> Capture</button></div></div></div>}
    {notice && <div className="toast"><Check size={18}/>{notice}</div>}
  </div>
}
