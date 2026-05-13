import { useWallet } from "@/lib/walletContext";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { shortAddr } from "@/lib/crypto";
import { SignOut, ShieldCheck, Wallet, Pulse } from "@phosphor-icons/react";

export default function Layout({ children, title, subtitle, role }) {
  const { session, logout } = useWallet();
  const nav = useNavigate();
  if (!session) return null;

  const roleColor = {
    admin: "text-terminal",
    doctor: "text-amber",
    patient: "text-cyan-400",
  }[session.role] || "text-zinc-300";

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 grid-bg">
      <header className="sticky top-0 z-40 bg-[#09090b]/90 backdrop-blur-md border-b border-zinc-800">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-terminal/60 flex items-center justify-center" data-testid="brand-logo">
              <ShieldCheck size={20} weight="bold" className="text-terminal" />
            </div>
            <div className="leading-none">
              <div className="font-display font-bold text-xl tracking-tighter">GEN_C</div>
              <div className="label-eyebrow mt-1">decentralized // ra-10173</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <div className="text-right">
              <div className="label-eyebrow">connected</div>
              <div className={`font-mono text-sm ${roleColor} flex items-center gap-2 justify-end`}>
                <Pulse size={14} weight="bold" className="animate-pulse" />
                {session.role.toUpperCase()} <span className="text-zinc-500">::</span>{" "}
                <span data-testid="connected-address">{shortAddr(session.address)}</span>
              </div>
            </div>
            <Button
              data-testid="logout-btn"
              variant="outline"
              className="rounded-none border-zinc-700 text-zinc-300 font-mono uppercase tracking-widest text-xs hover:bg-zinc-900 hover:text-terminal"
              onClick={() => { logout(); nav("/"); }}
            >
              <SignOut size={14} weight="bold" className="mr-2" />Disconnect
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
        <div className="mb-10 border-b border-zinc-800 pb-6">
          <div className="label-eyebrow mb-3">{role || session.role}</div>
          <h1 className="heading-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-none">
            {title}
          </h1>
          {subtitle && <p className="mt-4 text-zinc-400 text-sm sm:text-base max-w-2xl">{subtitle}</p>}
        </div>
        {children}
      </main>

      <footer className="border-t border-zinc-800 mt-20">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6 flex flex-col sm:flex-row justify-between gap-2 text-xs text-zinc-500 font-mono">
          <div>GEN_C // thesis prototype // privacy-by-design</div>
          <div>AES-256 + CP-ABE (sim) // QBFT (sim) // Pinata IPFS // LPA Merkle Anchoring</div>
        </div>
      </footer>
    </div>
  );
}
