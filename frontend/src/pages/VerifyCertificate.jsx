import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Hash } from "@/components/CryptoString";
import { motion } from "framer-motion";
import { ShieldCheck, CheckCircle, XCircle, ArrowLeft, Pulse } from "@phosphor-icons/react";

export default function VerifyCertificate() {
  const nav = useNavigate();
  const location = useLocation();
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [cert, setCert] = useState(null);

  useEffect(() => {
    // Optional: auto-verify if a certificate was passed via URL hash (base64 JSON)
    const hash = location.hash || "";
    const m = hash.match(/cert=([^&]+)/);
    if (m) {
      try {
        const decoded = JSON.parse(atob(decodeURIComponent(m[1])));
        setCert(decoded);
        setPasted(JSON.stringify(decoded, null, 2));
        verify(decoded);
      } catch {}
    }
  }, [location.hash]);

  const verify = async (c) => {
    setBusy(true);
    setResult(null);
    try {
      let parsed = c;
      if (!parsed) parsed = JSON.parse(pasted);
      setCert(parsed);
      const r = await api.post("/certificate/verify", { certificate: parsed });
      setResult(r.data);
    } catch (e) {
      setResult({ valid: false, reason: e?.response?.data?.detail || e.message || "Invalid JSON" });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setPasted(text);
    try { setCert(JSON.parse(text)); } catch {}
  };

  return (
    <div className="min-h-screen bg-mesh relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-soft pointer-events-none" />
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[34rem] h-[34rem] rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-10 lg:py-14">
        <div className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-400 flex items-center justify-center shadow-glow">
              <ShieldCheck size={20} weight="bold" className="text-zinc-950" />
            </div>
            <div className="leading-tight">
              <div className="font-display font-bold text-xl">Gen C</div>
              <div className="eyebrow mt-0.5">public verification</div>
            </div>
          </div>
          <button onClick={() => nav("/")} className="text-xs font-mono text-zinc-500 hover:text-sky-400 flex items-center gap-1.5">
            <ArrowLeft size={14} weight="bold" /> back to sign-in
          </button>
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="eyebrow mb-3">zero-knowledge attestation</div>
          <h1 className="heading-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.02] mb-3">
            Verify a Gen C <span className="bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">certificate</span>.
          </h1>
          <p className="text-zinc-400 max-w-2xl text-sm sm:text-base">Paste a JSON certificate or drop a file. We recompute the Merkle proof and confirm the root is anchored on the chain — without ever decrypting the underlying record.</p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-10">
          <div className="card-modern p-6 lg:col-span-3">
            <div className="eyebrow mb-2">step 01 // input</div>
            <h3 className="heading-display text-xl font-bold mb-4">Certificate JSON</h3>

            <Textarea
              data-testid="verify-textarea"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={14}
              placeholder='{"kind":"GenC.MedicalRecordCertificate", ... }'
              className="rounded-lg bg-zinc-900/70 border-white/5 font-mono text-[11px] min-h-[300px]"
            />

            <div className="flex gap-3 mt-4 flex-wrap">
              <button data-testid="verify-btn" onClick={() => verify()} disabled={busy || !pasted}
                className="btn-primary-modern h-11 px-6 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={16} weight="bold" />
                {busy ? "Verifying…" : "Verify Certificate"}
              </button>
              <label className="btn-ghost-modern h-11 px-5 flex items-center gap-2 text-sm font-semibold cursor-pointer">
                upload .json
                <input data-testid="verify-file-input" type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
          </div>

          <div className="card-modern p-6 lg:col-span-2 min-h-[400px]">
            <div className="eyebrow mb-2">step 02 // result</div>
            <h3 className="heading-display text-xl font-bold mb-4">Verification</h3>

            {!result && (
              <div className="text-zinc-500 font-mono text-xs py-14 text-center rounded-lg border border-dashed border-white/10">
                <Pulse size={28} weight="duotone" className="mx-auto mb-3 text-zinc-600" />
                awaiting input…
              </div>
            )}
            {result && result.valid && (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                className="rounded-lg border border-sky-400/30 bg-sky-500/5 p-5" data-testid="verify-result-valid">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle size={32} weight="fill" className="text-sky-400" />
                  <div>
                    <div className="font-display text-2xl font-bold text-sky-400">Valid</div>
                    <div className="text-xs font-mono text-zinc-400">anchored on-chain</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div><span className="eyebrow">block</span> <div className="font-mono text-sky-400 mt-1">#{result.anchor.block_number}</div></div>
                  <div><span className="eyebrow">anchored at</span> <div className="font-mono text-xs text-zinc-300 mt-1">{new Date(result.anchor.anchored_at).toLocaleString()}</div></div>
                  <div className="pt-2"><Hash value={result.anchor.merkle_root} label="root" testId="result-root" /></div>
                  <div><Hash value={result.anchor.tx_hash} label="tx" testId="result-tx" /></div>
                  <div className="pt-3 border-t border-white/5 mt-3">
                    <div className="eyebrow">subject</div>
                    <div className="text-sm font-medium mt-1">{result.subject.diagnosis}</div>
                    {result.subject.patient_did && <div className="text-[10px] font-mono text-sky-400 mt-0.5">{result.subject.patient_did}</div>}
                    {result.subject.provider && !result.subject.provider.REDACTED && (
                      <div className="text-[11px] font-mono text-zinc-400 mt-1">{result.subject.provider.name} · {result.subject.provider.department}</div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
            {result && !result.valid && (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                className="rounded-lg border border-rose/40 bg-rose/5 p-5" data-testid="verify-result-invalid">
                <div className="flex items-center gap-3 mb-2">
                  <XCircle size={32} weight="fill" className="text-rose" />
                  <div>
                    <div className="font-display text-2xl font-bold text-rose">Invalid</div>
                    <div className="text-xs font-mono text-zinc-400">cryptographic check failed</div>
                  </div>
                </div>
                <div className="text-sm text-zinc-300 font-mono mt-3">{result.reason}</div>
                {result.derived_root && (
                  <div className="mt-3 space-y-2">
                    <Hash value={result.derived_root} label="derived" testId="result-derived" />
                    <Hash value={result.claimed_root} label="claimed" testId="result-claimed" />
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>

        <div className="mt-10 text-center text-xs text-zinc-500 font-mono">
          Gen C // public attestation endpoint // no decryption required // RA 10173 compliant
        </div>
      </div>
    </div>
  );
}
