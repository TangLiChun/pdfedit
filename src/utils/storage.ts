import type { AnnotationData, TextEditData, FormFieldData } from '../App'

const STORAGE_KEY = 'pdfedit_session'

interface SessionData {
  pdfBase64?: string
  answerPdfBase64?: string
  pageAnnotations: Record<number, AnnotationData[]>
  textEdits: Record<number, TextEditData[]>
  formFields: FormFieldData[]
  currentPage: number
  answerCurrentPage: number
  scale: number
  gradeMode: boolean
  editMode: string
  activeTool: string
  color: string
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function saveSession(data: SessionData & { pdfBytes?: Uint8Array; answerPdfBytes?: Uint8Array }) {
  try {
    const toStore: any = { ...data }
    if (data.pdfBytes) {
      toStore.pdfBase64 = uint8ToBase64(data.pdfBytes)
    }
    if (data.answerPdfBytes) {
      toStore.answerPdfBase64 = uint8ToBase64(data.answerPdfBytes)
    }
    delete toStore.pdfBytes
    delete toStore.answerPdfBytes
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  } catch (e) {
    console.error('Failed to save session:', e)
  }
}

export function loadSession(): (SessionData & { pdfBytes?: Uint8Array; answerPdfBytes?: Uint8Array }) | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionData
    const result: any = { ...parsed }
    if (parsed.pdfBase64) {
      result.pdfBytes = base64ToUint8(parsed.pdfBase64)
    }
    if (parsed.answerPdfBase64) {
      result.answerPdfBytes = base64ToUint8(parsed.answerPdfBase64)
    }
    return result
  } catch {
    return null
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}
