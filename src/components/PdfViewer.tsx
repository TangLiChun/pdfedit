import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Canvas, Rect, IText, Line, Triangle, Path } from 'fabric'
import type { AnnotationData, TextEditData } from '../App'

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

function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  return 'M ' + points.map(p => `${p.x} ${p.y}`).join(' L ')
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
}: PdfViewerProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const isDrawingRef = useRef(false)
  const startPointRef = useRef<{ x: number; y: number } | null>(null)
  const drawPointsRef = useRef<{ x: number; y: number }[]>([])
  const currentPathRef = useRef<any>(null)

  const getCanvasPoint = useCallback((nativeEvt: MouseEvent): { x: number; y: number } | null => {
    const el = fabricCanvasElRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: nativeEvt.clientX - rect.left,
      y: nativeEvt.clientY - rect.top,
    }
  }, [])

  // Render PDF page
  useEffect(() => {
    let cancelled = false

    const render = async () => {
      setLoading(true)
      const page = await pdfDoc.getPage(pageNumber)
      if (cancelled) {
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
        renderTextLayer(page, viewport)
      }

      if (!cancelled) setLoading(false)
    }

    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageNumber, scale, editMode])

  // Re-render text layer when textEdits change (only update content, don't recreate)
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

  const renderTextLayer = async (page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport) => {
    const textLayerDiv = textLayerRef.current!
    textLayerDiv.innerHTML = ''
    textLayerDiv.style.width = `${viewport.width}px`
    textLayerDiv.style.height = `${viewport.height}px`

    try {
      const textContent = await page.getTextContent()
      const items = textContent.items as any[]

      items.forEach((item) => {
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

  // Initialize Fabric canvas
  useEffect(() => {
    if (!fabricCanvasElRef.current || pageSize.width === 0 || editMode !== 'annotate') return

    if (fabricCanvasRef.current) {
      Promise.resolve(fabricCanvasRef.current.dispose()).catch(() => {})
      fabricCanvasRef.current = null
    }

    let fabricCanvas: Canvas
    try {
      fabricCanvas = new Canvas(fabricCanvasElRef.current, {
        width: pageSize.width,
        height: pageSize.height,
        selection: activeTool === 'select',
        backgroundColor: 'transparent',
        enablePointerEvents: false,
      })
    } catch (err) {
      console.error('Fabric canvas init failed:', err)
      return
    }
    fabricCanvasRef.current = fabricCanvas

    // Load saved annotations (async)
    const loadAnnotations = async () => {
      for (const ann of annotations) {
        try {
          const json = ann.fabricJson
          let obj
          if (json.type === 'rect') {
            obj = await Rect.fromObject(json)
          } else if (json.type === 'i-text') {
            obj = await IText.fromObject(json)
          } else if (json.type === 'line') {
            obj = await Line.fromObject(json)
          } else if (json.type === 'triangle') {
            obj = await Triangle.fromObject(json)
          } else if (json.type === 'path') {
            obj = await Path.fromObject(json)
          }
          if (obj) fabricCanvas.add(obj as any)
        } catch (err) {
          console.error('Failed to load annotation:', err)
        }
      }
      fabricCanvas.requestRenderAll()
    }
    loadAnnotations()

    // Set interaction mode
    fabricCanvas.selection = activeTool === 'select'
    fabricCanvas.forEachObject(obj => {
      obj.selectable = activeTool === 'select'
      obj.evented = activeTool === 'select'
    })

    // Drawing handlers
    if (activeTool !== 'select') {
      fabricCanvas.on('mouse:down', (e) => {
        const native = (e as any).e as MouseEvent
        const point = getCanvasPoint(native)
        if (!point) return
        isDrawingRef.current = true
        startPointRef.current = { x: point.x, y: point.y }

        if (activeTool === 'brush') {
          drawPointsRef.current = [{ x: point.x, y: point.y }]
          currentPathRef.current = null
        }
      })

      fabricCanvas.on('mouse:move', (e) => {
        if (!isDrawingRef.current) return
        const native = (e as any).e as MouseEvent
        const point = getCanvasPoint(native)
        if (!point) return

        if (activeTool === 'brush') {
          drawPointsRef.current.push({ x: point.x, y: point.y })

          if (currentPathRef.current) {
            fabricCanvas.remove(currentPathRef.current)
          }

          const pathData = pointsToPath(drawPointsRef.current)
          if (pathData) {
            const path = new Path(pathData, {
              stroke: color,
              strokeWidth: 2,
              fill: 'transparent',
              selectable: false,
              evented: false,
            })
            fabricCanvas.add(path)
            currentPathRef.current = path
          }
        }
      })

      fabricCanvas.on('mouse:up', (e) => {
        if (!isDrawingRef.current) return
        isDrawingRef.current = false

        if (activeTool === 'brush') {
          currentPathRef.current = null
          drawPointsRef.current = []

          const newAnns = fabricCanvas.getObjects().map((obj, i) => ({
            id: annotations[i]?.id || generateId(),
            fabricJson: obj.toObject(),
          }))
          onAnnotationsChange(newAnns)
          startPointRef.current = null
          return
        }

        const native = (e as any).e as MouseEvent
        if (!native || !startPointRef.current) return
        const point = getCanvasPoint(native)
        if (!point) return
        const start = startPointRef.current
        const end = point

        if (activeTool === 'rect') {
          const rect = new Rect({
            left: Math.min(start.x, end.x),
            top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            fill: hexToRgba(color, 0.3),
            stroke: color,
            strokeWidth: 2,
          })
          fabricCanvas.add(rect)
        } else if (activeTool === 'text') {
          const text = new IText('双击编辑', {
            left: end.x,
            top: end.y,
            fontSize: 20,
            fill: color,
          })
          fabricCanvas.add(text)
          text.enterEditing()
          text.selectAll()
        } else if (activeTool === 'arrow') {
          const dx = end.x - start.x
          const dy = end.y - start.y
          const angle = Math.atan2(dy, dx)
          const headLen = 15

          const line = new Line([start.x, start.y, end.x, end.y], {
            stroke: color,
            strokeWidth: 2,
          })

          const head = new Triangle({
            left: end.x,
            top: end.y,
            width: headLen,
            height: headLen,
            angle: (angle * 180 / Math.PI) + 90,
            fill: color,
            originX: 'center',
            originY: 'center',
          })

          fabricCanvas.add(line, head)
        }

        // Save all annotations
        const newAnns = fabricCanvas.getObjects().map((obj, i) => ({
          id: annotations[i]?.id || generateId(),
          fabricJson: obj.toObject(),
        }))
        onAnnotationsChange(newAnns)

        startPointRef.current = null
      })
    }

    // Save on modification
    const handleModified = () => {
      const newAnns = fabricCanvas.getObjects().map((obj, i) => ({
        id: annotations[i]?.id || generateId(),
        fabricJson: obj.toObject(),
      }))
      onAnnotationsChange(newAnns)
    }

    fabricCanvas.on('object:modified', handleModified)
    fabricCanvas.on('object:removed', handleModified)

    return () => {
      fabricCanvas.off('object:modified', handleModified)
      fabricCanvas.off('object:removed', handleModified)
      Promise.resolve(fabricCanvas.dispose()).catch(() => {})
    }
  }, [pageSize, activeTool, editMode, color])

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
            ref={fabricCanvasElRef}
            className="absolute top-0 left-0 z-10"
            style={{ width: pageSize.width, height: pageSize.height }}
          />
        )}
        {editMode === 'text' && pageSize.width > 0 && (
          <div
            ref={textLayerRef}
            className="absolute top-0 left-0 z-20"
            style={{ width: pageSize.width, height: pageSize.height, lineHeight: 1 }}
          />
        )}
      </div>
    </div>
  )
}
