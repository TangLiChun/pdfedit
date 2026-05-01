import { useState, useEffect, useRef } from 'react'

type Tool = 'select' | 'rect' | 'arrow' | 'text' | 'brush'
type EditMode = 'view' | 'annotate' | 'form' | 'text'

interface ToolbarProps {
  currentPage: number
  numPages: number
  scale: number
  activeTool: Tool
  color: string
  editMode: EditMode
  gradeMode: boolean
  onPageChange: (page: number) => void
  onScaleChange: (scale: number) => void
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onEditModeChange: (mode: EditMode) => void
  onGradeModeChange: (grade: boolean) => void
  onRotatePage: () => void
  onDeletePage: () => void
  onLoadAnswer: () => void
  hasAnswer: boolean
  searchQuery?: string
  searchResultCount?: number
  currentSearchIndex?: number
  onSearch?: (query: string) => void
  onSearchNext?: () => void
  onSearchPrev?: () => void
  onAutoGrade?: () => void
  isGrading?: boolean
  onAIGrade?: () => void
  isAIGrading?: boolean
  onOpenAISettings?: () => void
}

export default function Toolbar({
  currentPage,
  numPages,
  scale,
  activeTool,
  color,
  editMode,
  gradeMode,
  onPageChange,
  onScaleChange,
  onToolChange,
  onColorChange,
  onEditModeChange,
  onGradeModeChange,
  onRotatePage,
  onDeletePage,
  onLoadAnswer,
  hasAnswer,
  searchQuery = '',
  searchResultCount = 0,
  currentSearchIndex = -1,
  onSearch,
  onSearchNext,
  onSearchPrev,
  onAutoGrade,
  isGrading,
  onAIGrade,
  isAIGrading,
  onOpenAISettings,
}: ToolbarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [pageInput, setPageInput] = useState(String(currentPage))
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    setLocalSearch(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const page = parseInt(pageInput, 10)
    if (!isNaN(page) && page >= 1 && page <= numPages) {
      onPageChange(page)
    } else {
      setPageInput(String(currentPage))
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch?.(localSearch)
  }
  return (
    <div className="bg-white border-b px-4 py-2 flex items-center gap-4 flex-wrap">
      {/* Page navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          ←
        </button>
        <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
          <input
            type="text"
            value={pageInput}
            onChange={e => setPageInput(e.target.value)}
            onBlur={() => setPageInput(String(currentPage))}
            className="w-10 text-sm text-center border rounded px-1 py-0.5 focus:outline-none focus:border-blue-400"
          />
          <span className="text-sm text-gray-400">/ {numPages}</span>
        </form>
        <button
          onClick={() => onPageChange(Math.min(numPages, currentPage + 1))}
          disabled={currentPage >= numPages}
          className="px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          →
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* Scale */}
      <div className="flex items-center gap-2">
        <button onClick={() => onScaleChange(Math.max(0.25, scale - 0.25))} className="px-3 py-1 rounded hover:bg-gray-100">−</button>
        <span className="text-sm w-14 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => onScaleChange(Math.min(1, scale + 0.25))} className="px-3 py-1 rounded hover:bg-gray-100">+</button>
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* Page operations */}
      <div className="flex items-center gap-1">
        <button onClick={onRotatePage} className="px-3 py-1 rounded hover:bg-gray-100 text-sm">↻ 旋转</button>
        <button onClick={onDeletePage} disabled={numPages <= 1} className="px-3 py-1 rounded hover:bg-red-50 text-sm text-red-600 disabled:opacity-30">删除</button>
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* Grade mode toggle */}
      <button
        onClick={() => onGradeModeChange(!gradeMode)}
        className={`px-3 py-1 rounded text-sm transition ${
          gradeMode ? 'bg-purple-100 text-purple-700' : 'hover:bg-gray-100'
        }`}
      >
        批改
      </button>

      <div className="w-px h-6 bg-gray-300" />

      {/* Edit mode tabs */}
      {!gradeMode && (
        <div className="flex items-center gap-1">
          {(['view', 'annotate', 'form', 'text'] as EditMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onEditModeChange(mode)}
              className={`px-3 py-1 rounded text-sm transition ${
                editMode === mode ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
              }`}
            >
              {mode === 'view' && '预览'}
              {mode === 'annotate' && '批注'}
              {mode === 'form' && '表单'}
              {mode === 'text' && '文本'}
            </button>
          ))}
        </div>
      )}

      {/* Grade mode: load answer + annotation tools */}
      {gradeMode && (
        <>
          {!hasAnswer && (
            <button
              onClick={onLoadAnswer}
              className="px-3 py-1 rounded text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
            >
              加载答案
            </button>
          )}
          <div className="flex items-center gap-1">
            {([
              { key: 'select', label: '选择' },
              { key: 'rect', label: '矩形' },
              { key: 'arrow', label: '箭头' },
              { key: 'text', label: '文字' },
              { key: 'brush', label: '画笔' },
            ] as { key: Tool; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onToolChange(key)}
                className={`px-3 py-1 rounded text-sm transition ${
                  activeTool === key ? 'bg-green-100 text-green-700' : 'hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-1">
            <input
              type="color"
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 p-0"
              title="选择颜色"
            />
          </div>
        </>
      )}

      {/* Annotation tools (normal mode) */}
      {!gradeMode && editMode === 'annotate' && (
        <>
          <div className="w-px h-6 bg-gray-300" />
          <div className="flex items-center gap-1">
            {([
              { key: 'select', label: '选择' },
              { key: 'rect', label: '矩形' },
              { key: 'arrow', label: '箭头' },
              { key: 'text', label: '文字' },
              { key: 'brush', label: '画笔' },
            ] as { key: Tool; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onToolChange(key)}
                className={`px-3 py-1 rounded text-sm transition ${
                  activeTool === key ? 'bg-green-100 text-green-700' : 'hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-1">
            <input
              type="color"
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 p-0"
              title="选择颜色"
            />
          </div>
        </>
      )}

      {/* Auto-grade button in grade mode */}
      {gradeMode && hasAnswer && (
        <>
          <div className="w-px h-6 bg-gray-300" />
          <button
            onClick={onAutoGrade}
            disabled={isGrading}
            className="px-3 py-1 rounded text-sm bg-orange-50 text-orange-700 hover:bg-orange-100 transition disabled:opacity-50"
          >
            {isGrading ? '比对中...' : '自动比对'}
          </button>
          <button
            onClick={onAIGrade}
            disabled={isAIGrading}
            className="px-3 py-1 rounded text-sm bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50"
          >
            {isAIGrading ? 'AI 批改中...' : 'AI 批改'}
          </button>
          <button
            onClick={onOpenAISettings}
            className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 transition"
            title="AI 设置"
          >
            ⚙️
          </button>
        </>
      )}

      <div className="w-px h-6 bg-gray-300" />

      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex items-center gap-1">
        <input
          ref={searchRef}
          type="text"
          placeholder="搜索文本..."
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          className="px-2 py-1 text-sm border rounded w-32 focus:outline-none focus:border-blue-400"
        />
        <button type="submit" className="px-2 py-1 rounded hover:bg-gray-100 text-sm">🔍</button>
        {searchResultCount > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">
              {currentSearchIndex + 1} / {searchResultCount}
            </span>
            <button onClick={onSearchPrev} className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-sm" type="button">↑</button>
            <button onClick={onSearchNext} className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-sm" type="button">↓</button>
          </div>
        )}
      </form>
    </div>
  )
}
