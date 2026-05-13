import { Copy } from "@phosphor-icons/react";
import { toast } from "sonner";

export function Hash({ value, label, testId }) {
  if (!value) return null;
  const copy = () => {
    navigator.clipboard.writeText(value);
    toast.success("Copied", { description: value.slice(0, 24) + "…" });
  };
  return (
    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 px-3 py-2 group" data-testid={testId}>
      {label && <span className="label-eyebrow shrink-0">{label}</span>}
      <span className="crypto-text truncate flex-1">{value}</span>
      <button
        onClick={copy}
        className="text-zinc-500 hover:text-terminal opacity-60 group-hover:opacity-100 transition"
        data-testid={`copy-${testId || "hash"}-btn`}
        aria-label="copy"
      >
        <Copy size={14} weight="bold" />
      </button>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    pending: "bg-amber/10 text-amber border-amber/40",
    anchored: "bg-terminal/10 text-terminal border-terminal/40",
    approved: "bg-terminal/10 text-terminal border-terminal/40",
    denied: "bg-danger/10 text-danger border-danger/40",
    encrypted: "bg-terminal/10 text-terminal border-terminal/40",
  };
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border ${map[status] || "text-zinc-400 border-zinc-700"}`}
      data-testid={`status-${status}`}
    >
      {status}
    </span>
  );
}
