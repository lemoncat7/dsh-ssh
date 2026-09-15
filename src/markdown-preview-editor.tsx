import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useEffect, useRef } from 'react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'

// Do not silently round-trip embedded HTML or frontmatter through a rich editor.
export function supportsMarkdownEditing(text: string): boolean {
  const withoutCode = text.replace(/```[^]*?```|~~~[^]*?~~~|`[^`]*`/g, '')
  return !/^\uFEFF?(?:---|\+\+\+)\r?\n/.test(text) && !/<\/?[a-z!][^>]*>/i.test(withoutCode)
    && !/^\s*\[[^\]]+\]:/m.test(text) && !text.includes('\uFFFD')
}

export function MarkdownPreviewEditor({ text, editable, onChange, onSave }: {
  text: string; editable: boolean; onChange(text: string): void; onSave(): void
}): JSX.Element {
  const sshLocale = useSshLocale()
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<Editor>()
  const callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }
  useEffect(() => {
    const editor = new Editor({
      element: host.current!,
      extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, TableKit, Image, TaskList, TaskItem.configure({ nested: true })],
      content: text, contentType: 'markdown', editable,
      editorProps: {
        attributes: { class: 'dsh-ssh-markdown-preview dsh-ssh-markdown-editor', role: 'textbox', 'aria-label': t("markdown-preview-editor.markdownBody"), 'aria-multiline': 'true', spellcheck: 'false' },
        handleKeyDown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); callbacks.current.onSave(); return true }
          return false
        },
      },
      onUpdate: ({ editor }) => callbacks.current.onChange(editor.getMarkdown()),
    })
    instance.current = editor
    return () => { instance.current = undefined; editor.destroy() }
  }, [])
  useEffect(() => { instance.current?.setEditable(editable, false) }, [editable])
  useEffect(() => {
    instance.current?.view.dom.setAttribute('aria-label', t('markdown-preview-editor.markdownBody'))
  }, [sshLocale])
  useEffect(() => {
    const editor = instance.current
    const comparable = (value: string) => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n+$/, '')
    if (editor && comparable(editor.getMarkdown()) !== comparable(text)) {
      const parent = host.current?.parentElement
      const top = parent?.scrollTop ?? 0
      editor.commands.setContent(text, { contentType: 'markdown', emitUpdate: false })
      if (parent) parent.scrollTop = top
    }
  }, [text])
  return <div ref={host} className="dsh-ssh-markdown-editor-host" />
}
