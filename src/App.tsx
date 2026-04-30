import { useState, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import PdfViewer from './components/PdfViewer'
import Toolbar from './components/Toolbar'
import FormPanel from './components/FormPanel'

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

export default function App() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [pdfDocProxy, setPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pdfLibDoc, setPdfLibDoc] = useState<PDFDocument | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)

  const [answerPdfDocProxy, setAnswerPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
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

  const loadPdf = useCallback(async (bytes: Uint8Array) => {
    setPdfBytes(new Uint8Array(bytes))
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
    const pdf = await loadingTask.promise
    setPdfDocProxy(pdf)
    const libDoc = await PDFDocument.load(new Uint8Array(bytes))
    setPdfLibDoc(libDoc)
    setNumPages(pdf.numPages)
    setCurrentPage(1)
    try {
      const form = libDoc.getForm()
      const fields = form.getFields()
      setFormFields(fields.map(f => ({
        name: f.getName(),
        type: f.constructor.name.replace('PDF', '').replace('Field', ''),
        value: '',
      })))
    } catch {
      setFormFields([])
    }
  }, [])

  const loadAnswerPdf = useCallback(async (bytes: Uint8Array) => {
    const loadingTask = pdfjsLib.getDocument({ data: bytes })
    const pdf = await loadingTask.promise
    setAnswerPdfDocProxy(pdf)
    setAnswerNumPages(pdf.numPages)
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    setPageAnnotations({})
    setTextEdits({})
    await loadPdf(bytes)
  }, [loadPdf])

  const handleAnswerFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await loadAnswerPdf(bytes)
  }, [loadAnswerPdf])

  const handleRotatePage = useCallback(async () => {
    if (!pdfLibDoc || !pdfBytes) return
    const pages = pdfLibDoc.getPages()
    const page = pages[currentPage - 1]
    const currentRotation = page.getRotation().angle
    page.setRotation(degrees(currentRotation + 90))
    const bytes = await pdfLibDoc.save()
    await loadPdf(bytes)
  }, [pdfLibDoc, pdfBytes, currentPage, loadPdf])

  const handleDeletePage = useCallback(async () => {
    if (!pdfLibDoc || !pdfBytes || numPages <= 1) return
    pdfLibDoc.removePage(currentPage - 1)
    const bytes = await pdfLibDoc.save()
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
              y: height - ann.y,
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">PDF Edit</h1>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
          <input ref={answerInputRef} type="file" accept=".pdf" className="hidden" onChange={handleAnswerFileChange} />
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">打开 PDF</button>
          <button onClick={handleDownload} disabled={!pdfBytes} className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50 transition">下载</button>
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
                  <PdfViewer pdfDoc={pdfDocProxy} pageNumber={currentPage} scale={scale} activeTool={activeTool} color={color} annotations={pageAnnotations[currentPage] || []} onAnnotationsChange={(anns) => setPageAnnotations(prev => ({ ...prev, [currentPage]: anns }))} editMode={editMode === 'annotate' ? 'annotate' : 'view'} onTextEdit={handleTextEdit} textEdits={textEdits[currentPage] || []} />
                </main>
              </>
            ) : (
              <>
                <main className="flex-1 overflow-auto bg-gray-200 p-8">
                  <PdfViewer pdfDoc={pdfDocProxy} pageNumber={currentPage} scale={scale} activeTool={activeTool} color={color} annotations={pageAnnotations[currentPage] || []} onAnnotationsChange={(anns) => setPageAnnotations(prev => ({ ...prev, [currentPage]: anns }))} editMode={editMode} onTextEdit={handleTextEdit} textEdits={textEdits[currentPage] || []} />
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
            <p className="text-gray-500 text-lg">点击上传 PDF 文件</p>
            <p className="text-gray-400 mt-2">或拖拽文件到此处</p>
          </div>
        </div>
      )}
    </div>
  )
}
