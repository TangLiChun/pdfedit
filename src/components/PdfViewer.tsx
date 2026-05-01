import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { AnnotationData, TextEditData } from '../App'
import { aiComplete, loadAISettings } from '../utils/ai'

interface PdfViewerProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  scale: number
  activeTool: 'select' | 'rect' | 'arrow' | 'text' | 'brush'
  color: string
  annotations: AnnotationData[]
  onAnnotationsChange: (annotations: AnnotationData[]) => void
  editMode: 'view' | 'annotate' | 'form' | 'text'
  onTextEdit?: (page: number, id: string, originalText: string, newText: string, x: number, y: number, fontSize: number) => void
  textEdits: TextEditData[]
  searchHighlights?: { x: number; y: number; width: number; height: number; isActive: boolean }[]
}

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function PdfViewer({
  pdfDoc,
  pageNumber,
  scale,
  activeTool,
  color,
  annotations,
  onAnnotationsChange,
  editMode,
  onTextEdit,
  textEdits,
  searchHighlights,
}: PdfViewerProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const annoCanvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })

  const isDrawingRef = useRef(false)
  const startPointRef = useRef<{ x: number; y: number } | null>(null)
  const currentPointsRef = useRef<{ x: number; y: number }[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)

  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string; visible: boolean } | null>(null)
  const [isAICompleting, setIsAICompleting] = useState(false)
  const renderGenRef = useRef(0)

  // Clear selection and text input when page changes
  useEffect(() => {
    setTextInput(null)
    setSelectedId(null)
  }, [pageNumber])

  const handleAIComplete = async () => {
    if (!textInput?.value.trim()) return
    const settings = loadAISettings()
    if (!settings?.apiKey) {
      alert('请先配置 AI API Key')
      return
    }
    setIsAICompleting(true)
    try {
      const completed = await aiComplete(settings, textInput.value)
      setTextInput({ ...textInput, value: textInput.value + completed })
    } catch (err: any) {
      alert('AI 补全失败: ' + (err.message || '未知错误'))
    } finally {
      setIsAICompleting(false)
    }
  }

  const getCanvasPoint = useCallback((e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
    const canvas = annoCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }, [])

  // Render PDF page
  useEffect(() => {
    let cancelled = false
    const gen = ++renderGenRef.current

    const render = async () => {
      setLoading(true)
      try {
        const page = await pdfDoc.getPage(pageNumber)
        if (cancelled || renderGenRef.current !== gen) {
          page.cleanup()
          return
        }

        const viewport = page.getViewport({ scale })
        const canvas = pdfCanvasRef.current!
        canvas.width = viewport.width
        canvas.height = viewport.height
        setPageSize({ width: viewport.width, height: viewport.height })

        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport }).promise

        if (editMode === 'text' && textLayerRef.current) {
          await renderTextLayer(page, viewport, gen)
        }

        page.cleanup()

        if (!cancelled && renderGenRef.current === gen) setLoading(false)
      } catch {
        if (!cancelled && renderGenRef.current === gen) setLoading(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageNumber, scale, editMode])

  // Sync annotation canvas size and redraw
  useEffect(() => {
    const canvas = annoCanvasRef.current
    if (!canvas || pageSize.width === 0) return
    canvas.width = pageSize.width
    canvas.height = pageSize.height
    drawAnnotations()
  }, [pageSize])

  // Redraw annotations when they change
  useEffect(() => {
    drawAnnotations()
  }, [annotations, selectedId])

  const drawAnnotations = () => {
    const canvas = annoCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    annotations.forEach(ann => {
      const isSelected = ann.id === selectedId
      if (isSelected) {
        ctx.save()
        ctx.shadowColor = 'rgba(59, 130, 246, 0.8)'
        ctx.shadowBlur = 4
      }

      switch (ann.type) {
        case 'rect': {
          ctx.fillStyle = hexToRgba(ann.color, 0.3)
          ctx.fillRect(ann.x, ann.y, ann.w, ann.h)
          ctx.strokeStyle = ann.color
          ctx.lineWidth = 2
          ctx.strokeRect(ann.x, ann.y, ann.w, ann.h)
          break
        }
        case 'arrow': {
          drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2, ann.color)
          break
        }
        case 'text': {
          ctx.fillStyle = ann.color
          ctx.font = '20px sans-serif'
          ctx.fillText(ann.text, ann.x, ann.y + 20)
          break
        }
        case 'brush': {
          if (ann.points.length < 2) break
          ctx.beginPath()
          ctx.moveTo(ann.points[0].x, ann.points[0].y)
          for (let i = 1; i < ann.points.length; i++) {
            ctx.lineTo(ann.points[i].x, ann.points[i].y)
          }
          ctx.strokeStyle = ann.color
          ctx.lineWidth = 2
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
          break
        }
      }

      if (isSelected) {
        ctx.restore()
      }
    })
  }

  const drawArrow = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) => {
    const headLen = 15
    const dx = x2 - x1
    const dy = y2 - y1
    const angle = Math.atan2(dy, dx)

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  const hitTest = (ann: AnnotationData, x: number, y: number): boolean => {
    switch (ann.type) {
      case 'rect':
        return x >= ann.x && x <= ann.x + ann.w && y >= ann.y && y <= ann.y + ann.h
      case 'arrow': {
        const minX = Math.min(ann.x1, ann.x2) - 10
        const maxX = Math.max(ann.x1, ann.x2) + 10
        const minY = Math.min(ann.y1, ann.y2) - 10
        const maxY = Math.max(ann.y1, ann.y2) + 10
        return x >= minX && x <= maxX && y >= minY && y <= maxY
      }
      case 'text': {
        const width = ann.text.length * 20
        return x >= ann.x && x <= ann.x + width && y >= ann.y && y <= ann.y + 24
      }
      case 'brush': {
        for (const p of ann.points) {
          if (Math.abs(p.x - x) < 8 && Math.abs(p.y - y) < 8) return true
        }
        return false
      }
    }
    return false
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editMode !== 'annotate') return
    const point = getCanvasPoint(e)
    if (!point) return

    if (activeTool === 'select') {
      for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i]
        if (hitTest(ann, point.x, point.y)) {
          setSelectedId(ann.id)
          dragOffsetRef.current = { x: point.x, y: point.y }
          isDrawingRef.current = true
          return
        }
      }
      setSelectedId(null)
      return
    }

    if (activeTool === 'text') {
      setTextInput({ x: point.x, y: point.y, value: '', visible: true })
      return
    }

    isDrawingRef.current = true
    startPointRef.current = point
    if (activeTool === 'brush') {
      currentPointsRef.current = [{ x: point.x, y: point.y }]
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingRef.current) return
    const point = getCanvasPoint(e)
    if (!point || !startPointRef.current) return

    const canvas = annoCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    if (activeTool === 'select' && selectedId && dragOffsetRef.current) {
      const dx = point.x - dragOffsetRef.current.x
      const dy = point.y - dragOffsetRef.current.y
      dragOffsetRef.current = { x: point.x, y: point.y }

      const newAnns = annotations.map(ann => {
        if (ann.id !== selectedId) return ann
        if (ann.type === 'rect') {
          return { ...ann, x: ann.x + dx, y: ann.y + dy }
        } else if (ann.type === 'arrow') {
          return { ...ann, x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy }
        } else if (ann.type === 'text') {
          return { ...ann, x: ann.x + dx, y: ann.y + dy }
        } else if (ann.type === 'brush') {
          return { ...ann, points: ann.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        }
        return ann
      })
      onAnnotationsChange(newAnns)
      return
    }

    if (activeTool === 'brush') {
      currentPointsRef.current.push({ x: point.x, y: point.y })
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawAnnotations()

      ctx.beginPath()
      const pts = currentPointsRef.current
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      return
    }

    if (activeTool === 'rect') {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawAnnotations()
      const start = startPointRef.current
      ctx.fillStyle = hexToRgba(color, 0.3)
      ctx.fillRect(start.x, start.y, point.x - start.x, point.y - start.y)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(start.x, start.y, point.x - start.x, point.y - start.y)
      return
    }

    if (activeTool === 'arrow') {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawAnnotations()
      drawArrow(ctx, startPointRef.current.x, startPointRef.current.y, point.x, point.y, color)
      return
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    if (activeTool === 'select') {
      dragOffsetRef.current = null
      return
    }

    const point = getCanvasPoint(e)
    if (!point || !startPointRef.current) return
    const start = startPointRef.current
    const end = point

    if (activeTool === 'rect') {
      const w = Math.abs(end.x - start.x)
      const h = Math.abs(end.y - start.y)
      if (w < 5 || h < 5) {
        drawAnnotations()
        return
      }
      const newAnn: AnnotationData = {
        id: generateId(),
        type: 'rect',
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w,
        h,
        color,
      }
      onAnnotationsChange([...annotations, newAnn])
    } else if (activeTool === 'arrow') {
      if (Math.abs(end.x - start.x) < 5 && Math.abs(end.y - start.y) < 5) {
        drawAnnotations()
        return
      }
      const newAnn: AnnotationData = {
        id: generateId(),
        type: 'arrow',
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        color,
      }
      onAnnotationsChange([...annotations, newAnn])
    } else if (activeTool === 'brush') {
      if (currentPointsRef.current.length < 2) {
        drawAnnotations()
        return
      }
      const newAnn: AnnotationData = {
        id: generateId(),
        type: 'brush',
        points: [...currentPointsRef.current],
        color,
      }
      onAnnotationsChange([...annotations, newAnn])
      currentPointsRef.current = []
    }

    startPointRef.current = null
    drawAnnotations()
  }

  const handleDeleteKey = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) {
        onAnnotationsChange(annotations.filter(a => a.id !== selectedId))
        setSelectedId(null)
      }
    }
  }, [selectedId, annotations, onAnnotationsChange])

  useEffect(() => {
    window.addEventListener('keydown', handleDeleteKey)
    return () => window.removeEventListener('keydown', handleDeleteKey)
  }, [handleDeleteKey])

  // Close text input when clicking outside
  useEffect(() => {
    if (!textInput?.visible) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.text-input-popup')) {
        setTextInput(null)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [textInput?.visible])

  const renderTextLayer = async (page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport, expectedGen: number) => {
    if (renderGenRef.current !== expectedGen) return
    const textLayerDiv = textLayerRef.current
    if (!textLayerDiv) return
    textLayerDiv.innerHTML = ''
    textLayerDiv.style.width = `${viewport.width}px`
    textLayerDiv.style.height = `${viewport.height}px`

    try {
      const textContent = await page.getTextContent()
      if (renderGenRef.current !== expectedGen) return
      const items = textContent.items as any[]

      items.forEach((item) => {
        if (renderGenRef.current !== expectedGen) return
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
        const fontHeight = Math.hypot(tx[0], tx[1])
        const angle = Math.atan2(tx[1], tx[0])
        const style = textContent.styles[item.fontName]
        const fontFamily = style?.fontFamily || 'sans-serif'

        const editId = `text-${pageNumber}-${item.str}-${tx[4].toFixed(1)}-${tx[5].toFixed(1)}`
        const existingEdit = textEdits.find(e => e.id === editId)

        const span = document.createElement('span')
        span.textContent = existingEdit?.newText || item.str
        span.setAttribute('data-edit-id', editId)
        span.style.position = 'absolute'
        span.style.left = `${tx[4]}px`
        span.style.top = `${tx[5] - fontHeight}px`
        span.style.fontSize = `${fontHeight}px`
        span.style.fontFamily = fontFamily
        span.style.transform = `rotate(${angle}rad)`
        span.style.transformOrigin = '0% 0%'
        span.style.whiteSpace = 'pre'
        span.style.cursor = 'text'
        span.style.minWidth = '10px'
        span.style.outline = 'none'
        span.contentEditable = 'true'
        span.className = 'hover:bg-yellow-100 focus:bg-yellow-200 focus:outline focus:outline-1 focus:outline-blue-400'

        span.addEventListener('blur', () => {
          const newText = span.textContent || ''
          const originalText = item.str
          if (newText !== originalText && onTextEdit) {
            onTextEdit(pageNumber, editId, originalText, newText, tx[4], tx[5], fontHeight)
          }
        })

        textLayerDiv.appendChild(span)
      })
    } catch (err) {
      console.error('Text layer render error:', err)
    }
  }

  useEffect(() => {
    if (editMode !== 'text' || !textLayerRef.current) return
    const spans = textLayerRef.current.querySelectorAll('span[contenteditable]')
    spans.forEach(span => {
      const editId = span.getAttribute('data-edit-id')
      if (!editId) return
      const edit = textEdits.find(e => e.id === editId)
      if (edit && span.textContent !== edit.newText) {
        span.textContent = edit.newText
      }
    })
  }, [textEdits, editMode])

  const handleTextSubmit = () => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null)
      return
    }
    const newAnn: AnnotationData = {
      id: generateId(),
      type: 'text',
      x: textInput.x,
      y: textInput.y,
      text: textInput.value,
      color,
    }
    onAnnotationsChange([...annotations, newAnn])
    setTextInput(null)
  }

  return (
    <div className="overflow-auto">
      <div className="relative shadow-lg bg-white mx-auto" style={{ width: pageSize.width || 'auto', height: pageSize.height || 'auto' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-30">
            <span className="text-gray-500">加载中...</span>
          </div>
        )}
        <canvas ref={pdfCanvasRef} className="block" />
        {editMode === 'annotate' && pageSize.width > 0 && (
          <canvas
            ref={annoCanvasRef}
            className="absolute top-0 left-0 z-10"
            style={{ width: pageSize.width, height: pageSize.height, cursor: activeTool === 'select' ? 'default' : 'crosshair' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
        )}
        {editMode === 'text' && pageSize.width > 0 && (
          <div
            ref={textLayerRef}
            className="absolute top-0 left-0 z-20"
            style={{ width: pageSize.width, height: pageSize.height, lineHeight: 1 }}
          />
        )}
        {/* Search highlights */}
        {searchHighlights && searchHighlights.length > 0 && pageSize.width > 0 && (
          <div className="absolute top-0 left-0 z-[25] pointer-events-none" style={{ width: pageSize.width, height: pageSize.height }}>
            {searchHighlights.map((hl, idx) => (
              <div
                key={idx}
                className="absolute"
                style={{
                  left: hl.x * scale,
                  top: hl.y * scale,
                  width: hl.width * scale,
                  height: hl.height * scale,
                  backgroundColor: hl.isActive ? 'rgba(255, 215, 0, 0.6)' : 'rgba(255, 255, 0, 0.4)',
                  border: hl.isActive ? '2px solid #f59e0b' : 'none',
                }}
              />
            ))}
          </div>
        )}
        {textInput?.visible && (
          <div
            className="text-input-popup absolute z-30 flex items-center gap-1 bg-white shadow-lg border rounded p-1"
            style={{ left: textInput.x, top: textInput.y }}
          >
            <input
              type="text"
              autoFocus
              className="border rounded px-2 py-1 text-sm outline-none"
              value={textInput.value}
              onChange={e => setTextInput({ ...textInput, value: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTextSubmit()
                if (e.key === 'Escape') setTextInput(null)
              }}
            />
            <button onClick={handleTextSubmit} className="px-2 py-1 bg-blue-600 text-white rounded text-sm">OK</button>
            <button
              onClick={handleAIComplete}
              disabled={isAICompleting || !textInput.value.trim()}
              className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded text-sm hover:bg-indigo-100 disabled:opacity-50"
              title="AI 续写"
            >
              {isAICompleting ? '...' : 'AI'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
