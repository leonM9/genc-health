import { useWallet } from "@/lib/walletContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { shortAddr } from "@/lib/crypto";
import { SignOut, ShieldCheck, Pulse } from "@phosphor-icons/react";

export default function Layout({ children, title, subtitle, role }) {
  const { session, logout } = useWallet();
  const nav = useNavigate();
  if (!session) return null;

  const roleAccent = {
    admin: { text: "text-amber", dot: "bg-amber" },
    doctor: { text: "text-teal-300", dot: "bg-teal-300" },
    patient: { text: "text-emerald-400", dot: "bg-emerald-400" },
  }[session.role] || { text: "text-zinc-300", dot: "bg-zinc-400" };

  return (
    <div className="min-h-screen bg-mesh">
      <div className="bg-grid-soft min-h-screen">
        <header className="sticky top-0 z-40 glass-strong border-b border-white/5">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between">
            <button onClick={() => nav("/dashboard")} className="flex items-center gap-3" data-testid="brand-logo">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-400 flex items-center justify-center shadow-glow">
                <ShieldCheck size={18} weight="bold" className="text-zinc-950" />
              </div>
              <div className="leading-tight text-left">
                <div className="font-display font-bold text-lg">Gen C</div>
                <div className="eyebrow !text-[9px] mt-0.5">privacy protocol</div>
              </div>
            </button>

            <div className="flex items-center gap-4">
              {session.picture && (
                <img src={session.picture} className="w-8 h-8 rounded-full border border-white/10" alt="" />
              )}
              <div className="hidden sm:block text-right">
                <div className="eyebrow !text-[9px]">connected</div>
                <div className={`font-mono text-xs flex items-center gap-2 justify-end mt-0.5 ${roleAccent.text}`}>
                  <Pulse size={12} weight="bold" />
                  {session.role.toUpperCase()} <span className="text-zinc-600">·</span>
                  <span data-testid="connected-address">{shortAddr(session.address)}</span>
                </div>
              </div>
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
            <div>AES-256 · CP-ABE (sim) · QBFT (sim) · Pinata IPFS · LPA</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
