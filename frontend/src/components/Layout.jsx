import { useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { useNavigate } from "react-router-dom";
import { shortAddr } from "@/lib/crypto";
import { copyToClipboard } from "@/lib/clipboard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTheme } from "@/lib/themeContext";
import { SignOut, ShieldCheck, Pulse, Key, Eye, EyeSlash, Copy, Download, Sun, Moon } from "@phosphor-icons/react";

export default function Layout({ children, title, subtitle, role }) {
  const { session, logout, exportPrivateKey } = useWallet();
  const { theme, toggle: toggleTheme } = useTheme();
  const nav = useNavigate();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPwd, setExportPwd] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportedPk, setExportedPk] = useState(null);
  const [pkVisible, setPkVisible] = useState(false);

  if (!session) return null;

  const roleAccent = {
    admin: { text: "text-amber", dot: "bg-amber" },
    doctor: { text: "text-cyan-300", dot: "bg-cyan-300" },
    patient: { text: "text-sky-400", dot: "bg-sky-400" },
  }[session.role] || { text: "text-zinc-300", dot: "bg-zinc-400" };

  const closeExport = () => {
    setExportOpen(false);
    setExportPwd("");
    setExportedPk(null);
    setPkVisible(false);
  };

  const doExport = async () => {
    if (!exportPwd) return toast.error("Enter your password to confirm");
    setExportBusy(true);
    try {
      const r = await exportPrivateKey(exportPwd);
      setExportedPk(r);
      toast.success("Private key released", { description: "Store it somewhere safe before closing" });
    } catch (e) {
      toast.error("Export failed", { description: e?.response?.data?.detail || e.message });
    } finally {
      setExportBusy(false);
    }
  };

  const downloadPk = () => {
    if (!exportedPk) return;
    const payload = JSON.stringify({
      kind: "GenC.WalletExport",
      version: "1.0",
      issued_at: new Date().toISOString(),
      ...exportedPk,
    }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gen-c-wallet-${exportedPk.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPk = async () => {
    if (!exportedPk?.wallet_private_key) return;
    const ok = await copyToClipboard(exportedPk.wallet_private_key);
    if (ok) toast.success("Private key copied");
    else toast.error("Copy blocked — select the text manually");
  };

  return (
    <div className="min-h-screen bg-mesh">
      <div className="bg-grid-soft min-h-screen">
        <header className="sticky top-0 z-40 glass-strong border-b border-white/5">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between">
            <button onClick={() => nav("/dashboard")} className="flex items-center gap-3" data-testid="brand-logo">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-400 flex items-center justify-center shadow-glow">
                <ShieldCheck size={18} weight="bold" className="text-zinc-950" />
              </div>
              <div className="leading-tight text-left">
                <div className="font-display font-bold text-lg">Gen C</div>
                <div className="eyebrow !text-[9px] mt-0.5">privacy protocol</div>
              </div>
            </button>

            <div className="flex items-center gap-3">
              {session.picture && (
                <img src={session.picture} className="w-8 h-8 rounded-full border border-white/10" alt="" />
              )}
              <div className="hidden sm:block text-right">
                <div className="eyebrow !text-[9px]">connected</div>
                <div className={`font-mono text-xs flex items-center gap-2 justify-end mt-0.5 ${roleAccent.text}`}>
                  <Pulse size={12} weight="bold" />
                  {session.role.toUpperCase()} <span className="text-zinc-600">·</span>
                  {session.username && <span className="text-zinc-300">{session.username}</span>}
                  {session.username && <span className="text-zinc-600">·</span>}
                  <span data-testid="connected-address">{shortAddr(session.address)}</span>
                </div>
              </div>

              <button
                data-testid="theme-toggle-btn"
                onClick={toggleTheme}
                className="h-9 w-9 rounded-lg btn-ghost-modern flex items-center justify-center"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun size={14} weight="bold" /> : <Moon size={14} weight="bold" />}
              </button>

              {session.username && (
                <button
                  data-testid="export-pk-btn"
                  onClick={() => setExportOpen(true)}
                  className="h-9 px-3 rounded-lg btn-ghost-modern text-xs font-semibold flex items-center gap-2"
                  title="Export your wallet private key (password required)"
                >
                  <Key size={14} weight="bold" />
                  <span className="hidden sm:inline">Export Key</span>
                </button>
              )}

              <button
                data-testid="logout-btn"
                onClick={async () => { await logout(); nav("/"); }}
                className="h-9 px-3 rounded-lg btn-ghost-modern text-xs font-semibold flex items-center gap-2"
              >
                <SignOut size={14} weight="bold" />
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-10 py-10">
          <div className="mb-10">
            <div className="eyebrow mb-3">{role || session.role}</div>
            <h1 className="heading-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.02]">{title}</h1>
            {subtitle && <p className="mt-4 text-zinc-400 text-sm sm:text-base max-w-2xl">{subtitle}</p>}
          </div>
          {children}
        </main>

        <footer className="border-t border-white/5 mt-20">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-10 py-6 flex flex-col sm:flex-row justify-between gap-2 text-xs text-zinc-500 font-mono">
            <div>Gen C // thesis prototype // privacy-by-design</div>
            <div>AES-256 · PBAE · QBFT · Pinata IPFS · LPA</div>
          </div>
        </footer>
      </div>

      {/* Export Private Key dialog */}
      <Dialog open={exportOpen} onOpenChange={(o) => (o ? setExportOpen(true) : closeExport())}>
        <DialogContent className="max-w-md rounded-2xl bg-zinc-950 border-amber/30" data-testid="export-pk-modal">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Key size={20} weight="duotone" className="text-amber" />
              Export wallet private key
            </DialogTitle>
          </DialogHeader>

          {!exportedPk ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Re-enter your password to release your wallet&apos;s private key. Anyone with this key can sign on your behalf — store it offline (paper, password manager, hardware wallet).
              </p>
              <div>
                <Label className="eyebrow">password</Label>
                <Input
                  data-testid="export-pk-password-input"
                  type="password"
                  value={exportPwd}
                  onChange={(e) => setExportPwd(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5 font-mono"
                  onKeyDown={(e) => e.key === "Enter" && doExport()}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber/30 bg-amber/5 p-3">
                <div className="eyebrow text-amber mb-1">wallet address</div>
                <div className="font-mono text-[11px] text-zinc-200 break-all" data-testid="exported-address">{exportedPk.wallet_address}</div>
              </div>
              <div className="rounded-lg border border-amber/40 bg-amber/10 p-3">
                <div className="eyebrow text-amber mb-1">private key — keep secret</div>
                <div className="font-mono text-[11px] text-zinc-100 break-all" data-testid="exported-private-key">
                  {pkVisible ? exportedPk.wallet_private_key : "•".repeat(Math.min(exportedPk.wallet_private_key.length, 64))}
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setPkVisible((v) => !v)}
                    data-testid="toggle-pk-visibility-btn"
                    className="h-8 px-3 rounded-lg border border-white/10 bg-zinc-900/60 text-zinc-200 font-mono text-[10px] uppercase tracking-wider flex items-center gap-1.5 hover:bg-zinc-800/60"
                  >
                    {pkVisible ? <EyeSlash size={12} weight="bold" /> : <Eye size={12} weight="bold" />}
                    {pkVisible ? "hide" : "reveal"}
                  </button>
                  <button
                    onClick={copyPk}
                    data-testid="copy-pk-btn"
                    className="h-8 px-3 rounded-lg border border-white/10 bg-zinc-900/60 text-zinc-200 font-mono text-[10px] uppercase tracking-wider flex items-center gap-1.5 hover:bg-zinc-800/60"
                  >
                    <Copy size={12} weight="bold" />copy
                  </button>
                  <button
                    onClick={downloadPk}
                    data-testid="download-pk-btn"
                    className="h-8 px-3 rounded-lg border border-sky-400/40 bg-sky-500/10 text-sky-200 font-mono text-[10px] uppercase tracking-wider flex items-center gap-1.5 hover:bg-sky-500/20"
                  >
                    <Download size={12} weight="bold" />download .json
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 font-mono leading-relaxed">
                This action was audited under RA 10173 §16 (Right to Data Portability).
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 mt-2">
            <button
              onClick={closeExport}
              data-testid="close-export-btn"
              className="btn-ghost-modern h-10 px-5 text-xs font-semibold"
            >
              Close
            </button>
            {!exportedPk && (
              <button
                onClick={doExport}
                disabled={exportBusy || !exportPwd}
                data-testid="confirm-export-btn"
                className="h-10 px-5 rounded-lg border border-amber/40 bg-amber/10 text-amber font-semibold text-xs hover:bg-amber/20 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Key size={12} weight="bold" />
                {exportBusy ? "Verifying…" : "Verify & reveal"}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
