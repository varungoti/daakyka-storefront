"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, List, ListOrdered, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * release-hardening F-12 (docs/audit-2026-09-19/admin-ux.md): a lightweight
 * rich-text editor for the product Description field, replacing the plain
 * `<textarea>`. Deliberately framework-free (no Tiptap/Slate/Quill —
 * `package.json` is shared/contended right now, and this repo doesn't need
 * a full editor framework for "bold, italic, lists, a link"): a
 * `contentEditable` surface with a small toolbar built on the browser's own
 * `document.execCommand`, which every evergreen browser still implements
 * for exactly this kind of simple formatting even though it's marked
 * deprecated in the spec.
 *
 * Security note: this component does *not* sanitize — it only produces
 * HTML and hands it to `onChange`. The trust boundary is server-side (see
 * `prepareDescriptionForStorage` / `sanitizeDescriptionHtml` in
 * src/lib/catalog/description-html.ts, applied in createProduct/
 * updateProduct), because client-side sanitization can always be bypassed
 * by calling the API directly. The `value` this component is fed should
 * already be safe HTML (the admin edit page runs the initial value through
 * `descriptionToSafeHtml` server-side — see
 * src/app/admin/(panel)/products/[id]/page.tsx) so re-opening a product
 * never round-trips genuinely untrusted markup back into the DOM.
 *
 * `contentEditable` is deliberately kept *uncontrolled* after mount (HTML
 * is written to the DOM once via `dangerouslySetInnerHTML`, not re-applied
 * on every keystroke) — a controlled contentEditable fights the browser's
 * own cursor/selection state and is a well-known source of cursor-jump
 * bugs. `value` is only re-synced into the DOM when it changes for a
 * reason *other* than this editor's own typing (e.g. switching which
 * product is loaded), guarded by an id so a fresh product swaps content
 * but a same-product re-render never clobbers an in-progress edit.
 */
export function RichTextEditor({
  value,
  onChange,
  editorKey,
  placeholder = "Describe the product — fabric, fit, care, what makes it worth buying…",
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: {
  value: string;
  onChange: (html: string) => void;
  /** Changes when the underlying record changes (e.g. a product id) so the
   * editor knows to reload `value` into the DOM rather than treating an
   * external change as stale. Defaults to a constant so a single-record
   * form (e.g. the new-product page) never needs to think about this. */
  editorKey?: string;
  placeholder?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const loadedKeyRef = useRef<string | undefined>(undefined);
  const [isEmpty, setIsEmpty] = useState(() => isHtmlEmpty(value));
  const [activeMarks, setActiveMarks] = useState<Record<string, boolean>>({});

  // Load `value` into the DOM on mount and whenever `editorKey` changes
  // (switching records) — never on every keystroke's own onChange, which
  // would fight the caret.
  useEffect(() => {
    if (!editorRef.current) return;
    if (loadedKeyRef.current === editorKey && loadedKeyRef.current !== undefined) return;
    editorRef.current.innerHTML = value;
    loadedKeyRef.current = editorKey;
    setIsEmpty(isHtmlEmpty(value));
    // Only re-run when the record identity changes, not on every `value`
    // prop update from our own typing — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  function emitChange() {
    const html = editorRef.current?.innerHTML ?? "";
    setIsEmpty(isHtmlEmpty(html));
    onChange(html);
  }

  function exec(command: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    updateActiveMarks();
    emitChange();
  }

  function updateActiveMarks() {
    try {
      setActiveMarks({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
      });
    } catch {
      // queryCommandState can throw in some environments (e.g. jsdom in
      // tests) — the toolbar simply won't show an active state, which is
      // cosmetic only.
    }
  }

  function addLink() {
    const url = window.prompt("Link URL (https://, mailto: or a relative path):");
    if (!url) return;
    const trimmed = url.trim();
    // Defense-in-depth only (the real guard is server-side sanitization),
    // but there's no reason to hand execCommand something obviously wrong.
    if (/^javascript:/i.test(trimmed)) return;
    exec("createLink", trimmed);
  }

  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    // Paste as plain text only — pasting rich HTML from Word/Google Docs
    // etc. tends to drag in inline styles and stray tags that would just
    // get stripped server-side anyway, so inserting plain text keeps what
    // the admin sees in the editor honest about what will actually be
    // saved. Multi-paragraph pastes still become separate <p>s because
    // `insertText` respects newlines the same way typing Enter would.
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emitChange();
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border focus-within:border-brand",
        ariaInvalid && "border-red-400",
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-muted p-1.5">
        <ToolbarButton label="Bold" active={activeMarks.bold} onClick={() => exec("bold")}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={activeMarks.italic} onClick={() => exec("italic")}>
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton label="Bulleted list" active={activeMarks.insertUnorderedList} onClick={() => exec("insertUnorderedList")}>
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={activeMarks.insertOrderedList} onClick={() => exec("insertOrderedList")}>
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton label="Add link" onClick={addLink}>
          <Link2 size={14} />
        </ToolbarButton>
        <ToolbarButton label="Remove link" onClick={() => exec("unlink")}>
          <Unlink size={14} />
        </ToolbarButton>
      </div>
      <div className="relative">
        {isEmpty ? <p className="pointer-events-none absolute left-2.5 top-2.5 text-sm text-muted/70">{placeholder}</p> : null}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className="min-h-[8rem] w-full p-2.5 text-sm text-ink outline-none [&_a]:text-brand [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
          onInput={emitChange}
          onPaste={onPaste}
          onKeyUp={updateActiveMarks}
          onMouseUp={updateActiveMarks}
          onBlur={updateActiveMarks}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      // mousedown (not click) + preventDefault keeps focus/selection in the
      // contentEditable area, so execCommand acts on the text the admin
      // actually had selected instead of losing the selection to the
      // button first.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "rounded-lg p-1.5 text-muted hover:bg-lilac/40 hover:text-ink",
        active && "bg-brand/10 text-brand",
      )}
    >
      {children}
    </button>
  );
}

function isHtmlEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim().length === 0;
}
