import { Copy } from "@phosphor-icons/react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

export function Hash({ value, label, testId }) {
  if (!value) return null;
  const copy = async () => {
    const ok = await copyToClipboard(value);
    if (ok) toast.success("Copied", { description: value.slice(0, 28) + "…" });
    else toast.error("Copy blocked — select the text manually");
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-900/60 border border-white/5 px-3 py-2 group" data-testid={testId}>
      {label && <span className="eyebrow !text-[9px] shrink-0">{label}</span>}
      <span className="crypto-text truncate flex-1">{value}</span>
      <button
        onClick={copy}
        className="text-zinc-500 hover:text-sky-400 opacity-60 group-hover:opacity-100 transition"
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
    pending: "bg-amber/10 text-amber border-amber/30",
    anchored: "bg-sky-500/10 text-sky-400 border-sky-400/30",
    approved: "bg-sky-500/10 text-sky-400 border-sky-400/30",
    denied: "bg-rose/10 text-rose border-rose/30",
    revoked: "bg-rose/10 text-rose border-rose/30",
    encrypted: "bg-cyan-400/10 text-cyan-300 border-cyan-300/30",
    admin: "bg-amber/10 text-amber border-amber/30",
    doctor: "bg-cyan-400/10 text-cyan-300 border-cyan-300/30",
    patient: "bg-sky-500/10 text-sky-400 border-sky-400/30",
  };
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${map[status] || "text-zinc-400 border-zinc-700"}`}
      data-testid={`status-${status}`}
    >
      {status}
    </span>
  );
}
