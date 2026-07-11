import { useEffect, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Braces, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2, Unlink } from 'lucide-react';

function ToolbarButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={`flex h-9 w-9 items-center justify-center rounded-lg ${active ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'} disabled:opacity-40`}>{children}</button>;
}

export default function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const editor = useEditor({
    extensions: [StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: { openOnClick: false, defaultProtocol: 'https', autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
    })],
    content: value || '<p></p>',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'min-h-[420px] px-5 py-5 text-[15px] leading-7 focus:outline-none',
        'aria-label': 'Blog article content',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="h-[480px] animate-pulse rounded-xl bg-muted" />;

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setLinkOpen(false);
    setLinkUrl('');
  };

  return (
    <div className="rich-editor overflow-hidden rounded-xl border border-border bg-card shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/60 p-2" role="toolbar" aria-label="Rich text formatting">
        <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolbarButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Strike" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></ToolbarButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Braces className="h-4 w-4" /></ToolbarButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolbarButton label="Add or edit link" active={editor.isActive('link')} onClick={() => { setLinkUrl(editor.getAttributes('link').href || ''); setLinkOpen((open) => !open); }}><LinkIcon className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Remove link" disabled={!editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()}><Unlink className="h-4 w-4" /></ToolbarButton>
      </div>
      {linkOpen && <div className="flex flex-col gap-2 border-b border-border bg-card p-3 sm:flex-row"><label className="sr-only" htmlFor="editor-link-url">Link URL</label><input id="editor-link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://example.com/resource" className="suite-input flex-1" /><button type="button" onClick={applyLink} className="trust-button">Apply link</button><button type="button" onClick={() => setLinkOpen(false)} className="quiet-button">Cancel</button></div>}
      <EditorContent editor={editor} />
    </div>
  );
}
