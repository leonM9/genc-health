import { Copy } from "@phosphor-icons/react";
import { toast } from "sonner";

export function Hash({ value, label, testId }) {
  if (!value) return null;
  const copy = () => {
    navigator.clipboard.writeText(value);
    toast.success("Copied", { description: value.slice(0, 28) + "…" });
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-900/60 border border-white/5 px-3 py-2 group" data-testid={testId}>
      {label && <span className="eyebrow !text-[9px] shrink-0">{label}</span>}
      <span className="crypto-text truncate flex-1">{value}</span>
      <button
        onClick={copy}
        className="text-zinc-500 hover:text-emerald-400 opacity-60 group-hover:opacity-100 transition"
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
    anchored: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30",
    approved: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30",
    denied: "bg-rose/10 text-rose border-rose/30",
    encrypted: "bg-teal-400/10 text-teal-300 border-teal-300/30",
    admin: "bg-amber/10 text-amber border-amber/30",
    doctor: "bg-teal-400/10 text-teal-300 border-teal-300/30",
    patient: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30",
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
