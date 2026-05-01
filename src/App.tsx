import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, degrees, rgb, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib'
import mammoth from 'mammoth'
import PdfViewer from './components/PdfViewer'
import Toolbar from './components/Toolbar'
import FormPanel from './components/FormPanel'
import { saveSession, loadSession, clearSession } from './utils/storage'
import { aiGrade, loadAISettings } from './utils/ai'
import AiSettings from './components/AiSettings'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

export interface RectAnnotation {
  id: string
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  color: string
}

export interface ArrowAnnotation {
  id: string
  type: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
}

export interface TextAnnotation {
  id: string
  type: 'text'
  x: number
  y: number
  text: string
  color: string
}

export interface BrushAnnotation {
  id: string
  type: 'brush'
  points: { x: number; y: number }[]
  color: string
}

export type AnnotationData = RectAnnotation | ArrowAnnotation | TextAnnotation | BrushAnnotation

export interface TextEditData {
  id: string
  originalText: string
  newText: string
  x: number
  y: number
  fontSize: number
  page: number
}

export interface FormFieldData {
  name: string
  type: string
  value: string
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return rgb(r, g, b)
}

async function canvasToUint8(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (blob) {
        const arrayBuffer = await blob.arrayBuffer()
        resolve(new Uint8Array(arrayBuffer))
      } else {
        resolve(new Uint8Array())
      }
    }, 'image/png')
  })
}

async function createPdfFromText(text: string): Promise<Uint8Array> {
  const lines = text.split('\n')
  const fontSize = 11
  const lineHeight = fontSize * 1.6
  const margin = 50
  const pageWidth = 595
  const pageHeight = 842
  const maxLineWidth = pageWidth - margin * 2
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(pageWidth * dpr)
  canvas.height = Math.floor(pageHeight * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.font = `${fontSize}px sans-serif`

  function wrapLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    for (const char of line) {
      const test = current + char
      if (ctx.measureText(test).width > maxLineWidth && current) {
        result.push(current)
        current = char
      } else {
        current = test
      }
    }
    if (current) result.push(current)
    return result.length ? result : [line]
  }

  function clearPage() {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pageWidth, pageHeight)
    ctx.fillStyle = '#000000'
  }

  const pageImages: Uint8Array[] = []
  let currentY = margin
  clearPage()

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line) {
      if (currentY + lineHeight > pageHeight - margin) {
        pageImages.push(await canvasToUint8(canvas))
        clearPage()
        currentY = margin
      }
      currentY += lineHeight
      continue
    }
    const wrapped = wrapLine(line)
    for (const wl of wrapped) {
      if (currentY + lineHeight > pageHeight - margin) {
        pageImages.push(await canvasToUint8(canvas))
        clearPage()
        currentY = margin
      }
      ctx.fillText(wl, margin, currentY + fontSize)
      currentY += lineHeight
    }
  }

  if (currentY > margin || pageImages.length === 0) {
    pageImages.push(await canvasToUint8(canvas))
  }

  const doc = await PDFDocument.create()
  for (const imgBytes of pageImages) {
    if (imgBytes.length === 0) continue
    const img = await doc.embedPng(imgBytes)
    const page = doc.addPage([pageWidth, pageHeight])
    page.drawImage(img, { x: 0, y: 0, width: pageWidth, height: pageHeight })
  }

  if (doc.getPageCount() === 0) {
    doc.addPage([pageWidth, pageHeight])
  }

  return new Uint8Array(await doc.save())
}

export default function App() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [pdfDocProxy, setPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pdfLibDoc, setPdfLibDoc] = useState<PDFDocument | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)

  const [answerPdfDocProxy, setAnswerPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [answerPdfBytes, setAnswerPdfBytes] = useState<Uint8Array | null>(null)
  const [answerNumPages, setAnswerNumPages] = useState(0)
  const [answerCurrentPage, setAnswerCurrentPage] = useState(1)

  const [gradeMode, setGradeMode] = useState(false)
  const [editMode, setEditMode] = useState<'view' | 'annotate' | 'form' | 'text'>('view')
  const [activeTool, setActiveTool] = useState<'select' | 'rect' | 'arrow' | 'text' | 'brush'>('select')
  const [color, setColor] = useState('#ff0000')
  const [pageAnnotations, setPageAnnotations] = useState<Record<number, AnnotationData[]>>({})
  const [textEdits, setTextEdits] = useState<Record<number, TextEditData[]>>({})
  const [formFields, setFormFields] = useState<FormFieldData[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const answerInputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ page: number; x: number; y: number; width: number; height: number; text: string }[]>([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1)
  const [isAutoGrading, setIsAutoGrading] = useState(false)
  const [isAIGrading, setIsAIGrading] = useState(false)
  const [showAISettings, setShowAISettings] = useState(false)
  const [aiGradeResult, setAiGradeResult] = useState<{ score: number; comments: string } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const currentPageSearchHighlights = useMemo(() => {
    const pageResults = searchResults.filter(r => r.page === currentPage)
    const pageStartIndex = searchResults.filter(r => r.page < currentPage).length
    return pageResults.map((r, i) => ({
      x: r.x, y: r.y, width: r.width, height: r.height,
      isActive: pageStartIndex + i === currentSearchIndex,
    }))
  }, [searchResults, currentPage, currentSearchIndex])

  const loadPdf = useCallback(async (bytes: Uint8Array) => {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
      const pdf = await loadingTask.promise
      const libDoc = await PDFDocument.load(new Uint8Array(bytes))
      // Only set state after both validations pass
      setPdfBytes(new Uint8Array(bytes))
      setPdfDocProxy(pdf)
      setPdfLibDoc(libDoc)
      setNumPages(pdf.numPages)
      setCurrentPage(1)
      setSearchResults([])
      setSearchQuery('')
      setCurrentSearchIndex(-1)
      setAiGradeResult(null)
      try {
        const form = libDoc.getForm()
        const fields = form.getFields()
        setFormFields(fields.map(f => {
          let type = 'Field'
          if (f instanceof PDFTextField) type = 'Text'
          else if (f instanceof PDFCheckBox) type = 'CheckBox'
          else if (f instanceof PDFRadioGroup) type = 'RadioGroup'
          else if (f instanceof PDFDropdown) type = 'Dropdown'
          else if (f instanceof PDFOptionList) type = 'OptionList'
          return {
            name: f.getName(),
            type,
            value: '',
          }
        }))
      } catch {
        setFormFields([])
      }
    } catch {
      alert('无法加载此文件，请确认是有效的 PDF 或 Word 文档。')
      throw new Error('Failed to load PDF')
    }
  }, [])

  const loadAnswerPdf = useCallback(async (bytes: Uint8Array) => {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
      const pdf = await loadingTask.promise
      setAnswerPdfBytes(new Uint8Array(bytes))
      setAnswerPdfDocProxy(pdf)
      setAnswerNumPages(pdf.numPages)
    } catch {
      alert('无法加载答案文件，请确认是有效的 PDF。')
      throw new Error('Failed to load answer PDF')
    }
  }, [])

  const processFile = useCallback(async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.extractRawText({ arrayBuffer })
        const pdfBytes = await createPdfFromText(result.value)
        await loadPdf(pdfBytes)
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await loadPdf(bytes)
      }
      setPageAnnotations({})
      setTextEdits({})
    } catch {
      // Error already alerted in loadPdf or createPdfFromText
    }
  }, [loadPdf])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processFile(file)
    e.target.value = ''
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const lowerName = file.name.toLowerCase()
    if (lowerName.endsWith('.pdf') || lowerName.endsWith('.docx')) {
      await processFile(file)
    }
  }, [processFile])

  const handleAnswerFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0]
      if (!file) return
      const bytes = new Uint8Array(await file.arrayBuffer())
      await loadAnswerPdf(bytes)
    } catch {
      // Error already alerted in loadAnswerPdf
    } finally {
      e.target.value = ''
    }
  }, [loadAnswerPdf])

  const handleRotatePage = useCallback(async () => {
    if (!pdfLibDoc || !pdfBytes) return
    const pages = pdfLibDoc.getPages()
    const page = pages[currentPage - 1]
    const currentRotation = page.getRotation().angle
    page.setRotation(degrees(currentRotation + 90))
    const bytes = await pdfLibDoc.save()
    const savedPage = currentPage
    await loadPdf(bytes)
    setCurrentPage(Math.min(savedPage, pages.length))
  }, [pdfLibDoc, pdfBytes, currentPage, loadPdf])

  const handleDeletePage = useCallback(async () => {
    if (!pdfLibDoc || !pdfBytes || numPages <= 1) return
    pdfLibDoc.removePage(currentPage - 1)
    const bytes = await pdfLibDoc.save()

    // Re-index annotations and textEdits after page deletion
    setPageAnnotations(prev => {
      const updated: Record<number, AnnotationData[]> = {}
      Object.entries(prev).forEach(([pageNum, anns]) => {
        const p = parseInt(pageNum)
        if (p < currentPage) {
          updated[p] = anns
        } else if (p > currentPage) {
          updated[p - 1] = anns
        }
        // p === currentPage: discard
      })
      return updated
    })
    setTextEdits(prev => {
      const updated: Record<number, TextEditData[]> = {}
      Object.entries(prev).forEach(([pageNum, edits]) => {
        const p = parseInt(pageNum)
        if (p < currentPage) {
          updated[p] = edits
        } else if (p > currentPage) {
          updated[p - 1] = edits.map(e => ({ ...e, page: p - 1 }))
        }
      })
      return updated
    })

    await loadPdf(bytes)
  }, [pdfLibDoc, pdfBytes, currentPage, numPages, loadPdf])

  const handleDownload = useCallback(async () => {
    if (!pdfLibDoc) return
    const currentBytes = await pdfLibDoc.save()
    const finalDoc = await PDFDocument.load(new Uint8Array(currentBytes))

    try {
      const form = finalDoc.getForm()
      formFields.forEach(field => {
        try {
          const f = form.getField(field.name)
          if (field.type === 'Text' && 'setText' in f) {
            (f as any).setText(field.value)
          }
        } catch { /* ignore */ }
      })
    } catch { /* no form */ }

    Object.entries(textEdits).forEach(([pageNum, edits]) => {
      const pageIndex = parseInt(pageNum) - 1
      const page = finalDoc.getPage(pageIndex)
      const { height } = page.getSize()
      edits.forEach(edit => {
        page.drawRectangle({
          x: edit.x,
          y: height - edit.y - edit.fontSize,
          width: edit.originalText.length * edit.fontSize * 0.6,
          height: edit.fontSize * 1.2,
          color: rgb(1, 1, 1),
        })
        page.drawText(edit.newText, {
          x: edit.x,
          y: height - edit.y,
          size: edit.fontSize,
          color: rgb(0, 0, 0),
        })
      })
    })

    Object.entries(pageAnnotations).forEach(([pageNum, anns]) => {
      const pageIndex = parseInt(pageNum) - 1
      const page = finalDoc.getPage(pageIndex)
      const { height } = page.getSize()
      anns.forEach(ann => {
        switch (ann.type) {
          case 'rect':
            page.drawRectangle({
              x: ann.x,
              y: height - ann.y - ann.h,
              width: ann.w,
              height: ann.h,
              color: hexToRgb(ann.color),
              opacity: 0.3,
            })
            break
          case 'text':
            page.drawText(ann.text, {
              x: ann.x,
              y: height - ann.y - 20,
              size: 20,
              color: hexToRgb(ann.color),
            })
            break
          case 'arrow':
            page.drawLine({
              start: { x: ann.x1, y: height - ann.y1 },
              end: { x: ann.x2, y: height - ann.y2 },
              thickness: 2,
              color: hexToRgb(ann.color),
            })
            break
          case 'brush':
            for (let i = 1; i < ann.points.length; i++) {
              page.drawLine({
                start: { x: ann.points[i - 1].x, y: height - ann.points[i - 1].y },
                end: { x: ann.points[i].x, y: height - ann.points[i].y },
                thickness: 2,
                color: hexToRgb(ann.color),
              })
            }
            break
        }
      })
    })

    const bytes = await finalDoc.save()
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'edited.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }, [pdfLibDoc, formFields, textEdits, pageAnnotations])

  const handleTextEdit = useCallback((page: number, id: string, originalText: string, newText: string, x: number, y: number, fontSize: number) => {
    if (newText === originalText) {
      setTextEdits(prev => ({
        ...prev,
        [page]: (prev[page] || []).filter(e => e.id !== id)
      }))
      return
    }
    setTextEdits(prev => ({
      ...prev,
      [page]: [
        ...(prev[page] || []).filter(e => e.id !== id),
        { id, originalText, newText, x, y, fontSize, page }
      ]
    }))
  }, [])

  const handleGradeModeChange = useCallback((enabled: boolean) => {
    setGradeMode(enabled)
    if (enabled && editMode === 'form') {
      setEditMode('view')
    }
  }, [editMode])

  // Search logic
  const handleSearch = useCallback(async (query: string) => {
    if (!pdfDocProxy || !query.trim()) {
      setSearchResults([])
      setCurrentSearchIndex(-1)
      setSearchQuery('')
      return
    }
    setSearchQuery(query)
    const results: { page: number; x: number; y: number; width: number; height: number; text: string }[] = []
    const lowerQuery = query.toLowerCase()
    for (let p = 1; p <= numPages; p++) {
      let page: pdfjsLib.PDFPageProxy | null = null
      try {
        page = await pdfDocProxy.getPage(p)
        const viewport = page.getViewport({ scale: 1 })
        const textContent = await page.getTextContent()
        const items = textContent.items as any[]
        items.forEach((item) => {
          if (item.str.toLowerCase().includes(lowerQuery)) {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
            const fontHeight = Math.hypot(tx[0], tx[1])
            results.push({
              page: p,
              x: tx[4],
              y: tx[5] - fontHeight,
              width: item.str.length * fontHeight * 0.6,
              height: fontHeight * 1.2,
              text: item.str,
            })
          }
        })
      } catch {
        // Skip pages that fail to load
      } finally {
        page?.cleanup()
      }
    }
    setSearchResults(results)
    setCurrentSearchIndex(results.length > 0 ? 0 : -1)
    if (results.length > 0) {
      setCurrentPage(results[0].page)
    }
  }, [pdfDocProxy, numPages])

  const handleSearchNext = useCallback(() => {
    if (searchResults.length === 0) return
    const nextIndex = (currentSearchIndex + 1) % searchResults.length
    setCurrentSearchIndex(nextIndex)
    setCurrentPage(searchResults[nextIndex].page)
  }, [searchResults, currentSearchIndex])

  const handleSearchPrev = useCallback(() => {
    if (searchResults.length === 0) return
    const prevIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length
    setCurrentSearchIndex(prevIndex)
    setCurrentPage(searchResults[prevIndex].page)
  }, [searchResults, currentSearchIndex])

  // Auto-grade: compare answer and student text
  const handleAutoGrade = useCallback(async () => {
    if (!pdfDocProxy || !answerPdfDocProxy) return
    setIsAutoGrading(true)
    try {
      const answerPage = await answerPdfDocProxy.getPage(answerCurrentPage)
      const answerText = await answerPage.getTextContent()
      const answerTexts = (answerText.items as any[]).map(item => item.str).join(' ')
      answerPage.cleanup()

      const studentPage = await pdfDocProxy.getPage(currentPage)
      const studentViewport = studentPage.getViewport({ scale: 1 })
      const studentText = await studentPage.getTextContent()
      const studentItems = studentText.items as any[]
      studentPage.cleanup()

      const newAnns: AnnotationData[] = []
      studentItems.forEach((item, idx) => {
        const str = item.str.trim()
        if (!str || str.length < 2) return
        if (!answerTexts.includes(str)) {
          const tx = pdfjsLib.Util.transform(studentViewport.transform, item.transform)
          const fontHeight = Math.hypot(tx[0], tx[1])
          newAnns.push({
            id: `grade-${Date.now()}-${idx}`,
            type: 'rect',
            x: tx[4] - 2,
            y: tx[5] - fontHeight - 2,
            w: str.length * fontHeight * 0.6 + 4,
            h: fontHeight + 4,
            color: '#ff0000',
          })
        }
      })

      if (newAnns.length > 0) {
        setPageAnnotations(prev => ({
          ...prev,
          [currentPage]: [...(prev[currentPage] || []), ...newAnns],
        }))
      }
    } catch {
      alert('自动比对失败，请检查答案和作业页面是否有效。')
    } finally {
      setIsAutoGrading(false)
    }
  }, [pdfDocProxy, answerPdfDocProxy, answerCurrentPage, currentPage])

  // AI Grade
  const handleAIGrade = useCallback(async () => {
    if (!pdfDocProxy || !answerPdfDocProxy) return
    const settings = loadAISettings()
    if (!settings || !settings.apiKey) {
      setShowAISettings(true)
      return
    }
    setIsAIGrading(true)
    setAiGradeResult(null)
    try {
      // Extract answer text
      const answerPage = await answerPdfDocProxy.getPage(answerCurrentPage)
      const answerTextContent = await answerPage.getTextContent()
      answerPage.cleanup()
      const answerTexts = (answerTextContent.items as any[]).map((item: any) => item.str).join('\n')

      // Extract student text
      const studentPage = await pdfDocProxy.getPage(currentPage)
      const studentViewport = studentPage.getViewport({ scale: 1 })
      const studentTextContent = await studentPage.getTextContent()
      const studentItems = studentTextContent.items as any[]
      const studentTexts = studentItems.map((item: any) => item.str).join('\n')
      studentPage.cleanup()

      // Call AI
      const result = await aiGrade(settings, answerTexts, studentTexts)

      // Add annotations for incorrect items
      const newAnns: AnnotationData[] = []
      studentItems.forEach((item: any, idx: number) => {
        const str = item.str.trim()
        if (!str) return
        // Find if AI flagged this text
        const detail = result.details.find((d: any) => str.includes(d.text) || d.text.includes(str))
        if (detail && !detail.isCorrect) {
          const tx = pdfjsLib.Util.transform(studentViewport.transform, item.transform)
          const fontHeight = Math.hypot(tx[0], tx[1])
          newAnns.push({
            id: `ai-grade-${Date.now()}-${idx}`,
            type: 'rect',
            x: tx[4] - 2,
            y: tx[5] - fontHeight - 2,
            w: str.length * fontHeight * 0.6 + 4,
            h: fontHeight + 4,
            color: '#dc2626',
          })
        }
      })

      // Add overall score as text annotation at top-left
      if (result.overallScore >= 0) {
        newAnns.push({
          id: `ai-score-${Date.now()}`,
          type: 'text',
          x: 20,
          y: 30,
          text: `AI 评分: ${result.overallScore}分`,
          color: '#dc2626',
        })
      }

      if (newAnns.length > 0) {
        setPageAnnotations(prev => ({
          ...prev,
          [currentPage]: [...(prev[currentPage] || []), ...newAnns],
        }))
      }

      setAiGradeResult({ score: result.overallScore, comments: result.comments })
    } catch (err: any) {
      alert('AI 批改失败: ' + (err.message || '未知错误'))
    } finally {
      setIsAIGrading(false)
    }
  }, [pdfDocProxy, answerPdfDocProxy, answerCurrentPage, currentPage])

  // Restore session on mount
  const hasRestored = useRef(false)
  useEffect(() => {
    if (hasRestored.current) return
    hasRestored.current = true

    const session = loadSession()
    if (!session) return

    const restore = async () => {
      if (session.pdfBytes) {
        await loadPdf(session.pdfBytes)
        if (session.pageAnnotations) setPageAnnotations(session.pageAnnotations)
        if (session.textEdits) setTextEdits(session.textEdits)
        if (session.currentPage) setCurrentPage(session.currentPage)
        if (session.scale) setScale(session.scale)
        if (session.gradeMode !== undefined) setGradeMode(session.gradeMode)
        if (session.editMode) setEditMode(session.editMode as any)
        if (session.activeTool) setActiveTool(session.activeTool as any)
        if (session.color) setColor(session.color)
        // Restore form field values after loadPdf sets the fields
        if (session.formFields?.length) {
          setFormFields(prev => {
            if (!prev.length) return session.formFields
            return prev.map(f => {
              const saved = session.formFields.find((sf: any) => sf.name === f.name)
              return saved ? { ...f, value: saved.value } : f
            })
          })
        }
      }
      if (session.answerPdfBytes) {
        await loadAnswerPdf(session.answerPdfBytes)
        if (session.answerCurrentPage) setAnswerCurrentPage(session.answerCurrentPage)
      }
    }

    restore()
  }, [loadPdf, loadAnswerPdf])

  // Cleanup pdf.js document proxies on unmount or change
  useEffect(() => {
    return () => {
      pdfDocProxy?.destroy().catch(() => {})
    }
  }, [pdfDocProxy])

  useEffect(() => {
    return () => {
      answerPdfDocProxy?.destroy().catch(() => {})
    }
  }, [answerPdfDocProxy])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (pdfBytes) handleDownload()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pdfBytes, handleDownload])

  // Clamp currentPage when numPages changes
  useEffect(() => {
    if (numPages > 0 && currentPage > numPages) {
      setCurrentPage(numPages)
    }
  }, [numPages, currentPage])

  // Auto-save session when state changes
  useEffect(() => {
    if (!pdfBytes) return
    saveSession({
      pdfBytes,
      answerPdfBytes: answerPdfBytes || undefined,
      pageAnnotations,
      textEdits,
      formFields,
      currentPage,
      answerCurrentPage,
      scale,
      gradeMode,
      editMode,
      activeTool,
      color,
    })
  }, [pdfBytes, answerPdfBytes, pageAnnotations, textEdits, formFields, currentPage, answerCurrentPage, scale, gradeMode, editMode, activeTool, color])

  return (
    <div
      className={`min-h-screen flex flex-col ${isDragging ? 'bg-blue-50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 bg-blue-500/20 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-lg shadow-xl px-8 py-6 text-center">
            <p className="text-xl font-bold text-blue-600">释放以上传文件</p>
            <p className="text-gray-500 mt-2">支持 PDF、Word 格式</p>
          </div>
        </div>
      )}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">PDF Edit</h1>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={handleFileChange} />
          <input ref={answerInputRef} type="file" accept=".pdf" className="hidden" onChange={handleAnswerFileChange} />
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">打开 PDF</button>
          <button onClick={handleDownload} disabled={!pdfBytes} className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50 transition">下载</button>
          <button onClick={() => { clearSession(); window.location.reload() }} className="px-4 py-2 bg-red-50 text-red-600 rounded hover:bg-red-100 transition text-sm">清除缓存</button>
        </div>
      </header>

      {pdfDocProxy ? (
        <>
          <Toolbar
            currentPage={currentPage}
            numPages={numPages}
            scale={scale}
            activeTool={activeTool}
            color={color}
            editMode={editMode}
            gradeMode={gradeMode}
            onPageChange={setCurrentPage}
            onScaleChange={setScale}
            onToolChange={setActiveTool}
            onColorChange={setColor}
            onEditModeChange={setEditMode}
            onGradeModeChange={handleGradeModeChange}
            onRotatePage={handleRotatePage}
            onDeletePage={handleDeletePage}
            onLoadAnswer={() => answerInputRef.current?.click()}
            hasAnswer={!!answerPdfDocProxy}
            searchQuery={searchQuery}
            searchResultCount={searchResults.length}
            currentSearchIndex={currentSearchIndex}
            onSearch={handleSearch}
            onSearchNext={handleSearchNext}
            onSearchPrev={handleSearchPrev}
            onAutoGrade={handleAutoGrade}
            isGrading={isAutoGrading}
            onAIGrade={handleAIGrade}
            isAIGrading={isAIGrading}
            onOpenAISettings={() => setShowAISettings(true)}
          />
          <div className="flex flex-1 overflow-hidden">
            {gradeMode ? (
              <>
                <main className="flex-1 overflow-auto bg-gray-200 p-4 border-r border-gray-300">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-gray-500 font-medium">答案</span>
                    {answerPdfDocProxy && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setAnswerCurrentPage(p => Math.max(1, p - 1))} disabled={answerCurrentPage <= 1} className="px-2 py-0.5 rounded hover:bg-gray-300 disabled:opacity-30 text-sm">←</button>
                        <span className="text-xs text-gray-500 min-w-[50px] text-center">{answerCurrentPage} / {answerNumPages}</span>
                        <button onClick={() => setAnswerCurrentPage(p => Math.min(answerNumPages, p + 1))} disabled={answerCurrentPage >= answerNumPages} className="px-2 py-0.5 rounded hover:bg-gray-300 disabled:opacity-30 text-sm">→</button>
                      </div>
                    )}
                  </div>
                  {answerPdfDocProxy ? (
                    <PdfViewer pdfDoc={answerPdfDocProxy} pageNumber={Math.min(answerCurrentPage, answerNumPages)} scale={scale} activeTool="select" color={color} annotations={[]} onAnnotationsChange={() => {}} editMode="view" textEdits={[]} />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-3">
                      <p className="text-gray-400 text-sm">尚未加载答案 PDF</p>
                      <button onClick={() => answerInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm">加载答案</button>
                    </div>
                  )}
                </main>
                <main className="flex-1 overflow-auto bg-gray-200 p-4">
                  <div className="mb-2 text-center text-sm text-gray-500 font-medium">作业</div>
                  <PdfViewer pdfDoc={pdfDocProxy} pageNumber={currentPage} scale={scale} activeTool={activeTool} color={color} annotations={pageAnnotations[currentPage] || []} onAnnotationsChange={(anns) => setPageAnnotations(prev => ({ ...prev, [currentPage]: anns }))} editMode={editMode === 'annotate' ? 'annotate' : 'view'} onTextEdit={handleTextEdit} textEdits={textEdits[currentPage] || []} searchHighlights={currentPageSearchHighlights} />
                </main>
              </>
            ) : (
              <>
                <main className="flex-1 overflow-auto bg-gray-200 p-8">
                  <PdfViewer pdfDoc={pdfDocProxy} pageNumber={currentPage} scale={scale} activeTool={activeTool} color={color} annotations={pageAnnotations[currentPage] || []} onAnnotationsChange={(anns) => setPageAnnotations(prev => ({ ...prev, [currentPage]: anns }))} editMode={editMode} onTextEdit={handleTextEdit} textEdits={textEdits[currentPage] || []} searchHighlights={currentPageSearchHighlights} />
                </main>
                {editMode === 'form' && (
                  <FormPanel fields={formFields} onChange={setFormFields} />
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-blue-500 transition" onClick={() => fileInputRef.current?.click()}>
            <p className="text-gray-500 text-lg">点击上传 PDF / Word 文件</p>
            <p className="text-gray-400 mt-2">支持 .pdf、.docx 格式</p>
          </div>
        </div>
      )}

      {showAISettings && <AiSettings onClose={() => setShowAISettings(false)} />}

      {aiGradeResult && (
        <div className="fixed bottom-4 right-4 bg-white shadow-lg border rounded-lg p-4 z-40 max-w-sm max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg text-indigo-700">AI 评分: {aiGradeResult.score}分</span>
            <button onClick={() => setAiGradeResult(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{aiGradeResult.comments}</p>
        </div>
      )}
    </div>
  )
}
