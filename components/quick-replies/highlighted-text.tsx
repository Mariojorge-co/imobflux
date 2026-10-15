import { splitVariableSegments } from "@/lib/quick-replies/variables";

/** Texto com quebras de linha preservadas e as variáveis `{{...}}` ainda não preenchidas em destaque. */
export function HighlightedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={["whitespace-pre-wrap break-words", className].filter(Boolean).join(" ")}>
      {splitVariableSegments(text).map((segment, index) =>
        segment.variable ? (
          <mark
            className="rounded-sm bg-amber-500/20 px-0.5 text-amber-800 dark:text-amber-300"
            data-testid="unresolved-variable"
            key={index}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
