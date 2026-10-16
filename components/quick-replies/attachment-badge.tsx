import { Paperclip } from "lucide-react";

/** Clipe com a quantidade de arquivos da resposta (some quando é só texto). */
export function AttachmentBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 align-middle text-caption font-medium text-text-muted"
      data-testid="quick-reply-has-files"
      title={count === 1 ? "Com 1 arquivo" : `Com ${count} arquivos`}
    >
      <Paperclip aria-hidden="true" size={12} />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{count === 1 ? "com 1 arquivo" : `com ${count} arquivos`}</span>
    </span>
  );
}
