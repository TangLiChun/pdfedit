import type { FormFieldData } from '../App'

interface FormPanelProps {
  fields: FormFieldData[]
  onChange: (fields: FormFieldData[]) => void
}

export default function FormPanel({ fields, onChange }: FormPanelProps) {
  if (fields.length === 0) {
    return (
      <div className="w-64 bg-white border-l p-4">
        <p className="text-gray-500 text-sm">此 PDF 没有可填写的表单</p>
      </div>
    )
  }

  return (
    <div className="w-72 bg-white border-l overflow-y-auto">
      <div className="p-4 border-b">
        <h3 className="font-medium">表单字段</h3>
        <p className="text-xs text-gray-500 mt-1">填写后点击下载保存</p>
      </div>
      <div className="p-4 space-y-3">
        {fields.map((field, index) => (
          <div key={field.name}>
            <label className="block text-xs text-gray-600 mb-1 truncate" title={field.name}>
              {field.name}
            </label>
            <input
              type="text"
              value={field.value}
              onChange={(e) => {
                const newFields = [...fields]
                newFields[index] = { ...field, value: e.target.value }
                onChange(newFields)
              }}
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={`${field.type}...`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
