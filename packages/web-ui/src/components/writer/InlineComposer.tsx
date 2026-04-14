import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { rewriteSelection } from "../../api/writer-client.js";
import { MentionDropdown, SKILL_ITEMS, type MentionSkillItem } from "./MentionDropdown.js";

export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface InlineComposerProps {
  projectId: string;
  sectionKey: string;
  selectedText: string;
  onCancel: () => void;
  onCompleted: () => void;
  /** Viewport rect of the selected text; composer anchors just below it. */
  anchorRect?: AnchorRect | null;
  // optional injection for tests
  _rewrite?: typeof rewriteSelection;
}

interface MentionState {
  active: boolean;
  start: number; // index of `@`
  activeIndex: number;
}

const EMPTY_MENTION: MentionState = {
  active: false,
  start: -1,
  activeIndex: 0,
};

export function InlineComposer(props: InlineComposerProps) {
  const { projectId, sectionKey, selectedText, onCancel, onCompleted, anchorRect } = props;
  const rewrite = props._rewrite ?? rewriteSelection;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<MentionState>(EMPTY_MENTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeMention = useCallback(() => setMention(EMPTY_MENTION), []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    const caret = e.target.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at >= 0) {
      const frag = before.slice(at + 1);
      // Only trigger dropdown for a bare `@` fragment (no whitespace yet, short)
      if (!/\s/.test(frag) && frag.length <= 40) {
        setMention({ active: true, start: at, activeIndex: 0 });
        return;
      }
    }
    closeMention();
  };

  const insertSkill = (item: MentionSkillItem) => {
    const caretNow = taRef.current?.selectionStart ?? value.length;
    const start = mention.start >= 0 ? mention.start : caretNow;
    const before = value.slice(0, start);
    const afterCaret = value.slice(caretNow);
    const nextVal = before + item.insertText + afterCaret;
    setValue(nextVal);
    closeMention();
    queueMicrotask(() => {
      const pos = before.length + item.insertText.length;
      taRef.current?.setSelectionRange(pos, pos);
      taRef.current?.focus();
    });
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // mention-mode keys (dropdown open)
    if (mention.active) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          activeIndex: Math.min(SKILL_ITEMS.length - 1, m.activeIndex + 1),
        }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => ({ ...m, activeIndex: Math.max(0, m.activeIndex - 1) }));
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        insertSkill(SKILL_ITEMS[mention.activeIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    // Plain Enter → submit; Shift+Enter → newline (default). ⌘↵/Ctrl+↵ still submits for safety.
    const isSubmitKey =
      e.key === "Enter" && (((e.metaKey || e.ctrlKey)) || (!e.shiftKey && !e.metaKey && !e.ctrlKey));
    if (isSubmitKey) {
      e.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const stream = rewrite(projectId, sectionKey, {
          selected_text: selectedText,
          user_prompt: value,
        });
        await new Promise<void>((resolve, reject) => {
          stream.onEvent((ev: { type: string; error?: string }) => {
            if (ev.type === "writer.completed") resolve();
            if (ev.type === "writer.failed") reject(new Error(ev.error ?? "rewrite failed"));
          });
        });
        onCompleted();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    }
  };

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const preview =
    selectedText.length > 60 ? selectedText.slice(0, 60) + "…" : selectedText;

  const anchorStyle = useMemo<CSSProperties | undefined>(() => {
    if (!anchorRect) return undefined;
    const COMPOSER_W = 480;
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
    const left = Math.min(Math.max(8, anchorRect.left), Math.max(8, viewportW - COMPOSER_W - 8));
    const top = Math.max(8, anchorRect.bottom + 8);
    return {
      position: "fixed",
      top,
      left,
      width: COMPOSER_W,
      maxWidth: "calc(100vw - 16px)",
      zIndex: 50,
    };
  }, [anchorRect]);

  return (
    <div
      data-testid="inline-composer"
      style={anchorStyle}
      className={
        anchorStyle
          ? "rounded-[6px] border border-hair-strong bg-bg-1 p-3 shadow-lg"
          : "mt-2 rounded-[6px] border border-hair bg-bg-1 p-3"
      }
    >
      <div className="mb-2 text-xs text-meta" data-testid="composer-preview">
        选中：<span className="text-body">{preview}</span>
      </div>
      <div className="relative">
        <textarea
          ref={taRef}
          data-testid="composer-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={4}
          placeholder="描述怎么改它，@ 引用素材..."
          className="w-full resize-y rounded-[2px] border border-hair bg-bg-2 text-body p-2 text-sm focus:outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-dim)]"
        />
        {mention.active && (
          <MentionDropdown
            items={SKILL_ITEMS}
            activeIndex={mention.activeIndex}
            onSelect={insertSkill}
            onHover={(i) => setMention((m) => ({ ...m, activeIndex: i }))}
          />
        )}
      </div>
      {error && (
        <div className="mt-1 text-xs text-red" data-testid="composer-error">
          {error}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-meta">
        <span className="font-mono-term">
          Esc 取消 · ↵ 提交 · ⇧↵ 换行{submitting ? "（提交中…）" : ""}
        </span>
        <button type="button" className="text-meta hover:text-accent underline bg-transparent border-0 cursor-pointer" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
