import { useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Wallet, Lightning, ShieldCheck, Lock, Cube, Fingerprint, GoogleLogo, ArrowRight, User, Key } from "@phosphor-icons/react";

export default function Login() {
  const { loginDemo, loginMetaMask, loginWithCredentials, session } = useWallet();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const nav = useNavigate();

  if (session) nav("/dashboard");

  const handle = async (fn, label) => {
    setBusy(true);
    try {
      const s = await fn();
      toast.success(`Authenticated`, { description: s.role === "unregistered" ? "Complete your profile" : `Welcome, ${s.role}` });
      setTimeout(() => nav(s.role === "unregistered" ? "/onboarding" : "/dashboard"), 300);
    } catch (e) {
      toast.error(`${label} failed`, { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  const submitCredentials = (ev) => {
    ev?.preventDefault?.();
    if (!username || !password) return toast.error("Username and password required");
    handle(() => loginWithCredentials(username.trim(), password), "Sign in");
  };

  const loginGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen bg-mesh relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-soft pointer-events-none" />
      <div className="absolute -top-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-sky-500/15 blur-3xl pointer-events-none animate-float" />
      <div className="absolute -bottom-32 -left-32 w-[24rem] h-[24rem] rounded-full bg-cyan-400/10 blur-3xl pointer-events-none animate-float" style={{ animationDelay: "2s" }} />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12 py-8 lg:py-12 min-h-screen flex flex-col">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-400 flex items-center justify-center shadow-glow">
              <ShieldCheck size={20} weight="bold" className="text-zinc-950" />
            </div>
            <div className="leading-tight">
              <div className="font-display font-bold text-xl tracking-tight">Gen C</div>
              <div className="eyebrow mt-0.5">v0.2 // privacy protocol</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse-glow" />
            network live
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-20 items-center py-12 lg:py-20">
          <motion.div className="lg:col-span-7" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span className="eyebrow !text-zinc-300">RA 10173 // privacy by design</span>
            </div>

            <h1 className="heading-display text-5xl sm:text-6xl lg:text-7xl xl:text-[5.5rem] font-bold leading-[0.95]">
              Your health,<br />
              encrypted under{" "}
              <span className="bg-gradient-to-r from-sky-400 via-cyan-300 to-sky-400 bg-clip-text text-transparent">your keys</span>.
            </h1>
            <p className="mt-7 max-w-xl text-zinc-400 text-base sm:text-lg leading-relaxed">
              A decentralized medical-record protocol that anchors hashes to a private EVM-compatible permissioned ledger via Layered Proof Aggregation. No plaintext ever touches the database, ledger, or middleware.
            </p>

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl">
              {[
                { icon: Lock, k: "Payload", v: "AES-256-GCM" },
                { icon: Fingerprint, k: "Policy", v: "PBAE" },
                { icon: Cube, k: "Storage", v: "IPFS / Pinata" },
                { icon: ShieldCheck, k: "Ledger", v: "Merkle Anchor" },
              ].map((it) => (
                <div key={it.k} className="card-modern p-4">
                  <it.icon size={20} weight="duotone" className="text-sky-400 mb-3" />
                  <div className="eyebrow text-[10px]">{it.k}</div>
                  <div className="text-sm font-mono mt-1 text-zinc-100">{it.v}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div className="lg:col-span-5" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}>
            <div className="glass-strong rounded-3xl p-7 sm:p-9 shadow-card">
              <div className="eyebrow mb-2">step 01 // identity</div>
              <h2 className="heading-display text-3xl font-bold mb-1.5">Sign in</h2>
              <p className="text-sm text-zinc-400 mb-7">Username &amp; password. Your wallet stays sealed until you authenticate.</p>

              <form onSubmit={submitCredentials} className="space-y-3">
                <div>
                  <Label className="eyebrow">username</Label>
                  <div className="relative mt-1.5">
                    <User size={16} weight="bold" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <Input
                      data-testid="login-username-input"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="doctor1 / patient1 / admin"
                      autoComplete="username"
                      className="pl-9 h-11 rounded-lg bg-zinc-900/60 border-white/5 font-mono text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label className="eyebrow">password</Label>
                  <div className="relative mt-1.5">
                    <Key size={16} weight="bold" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <Input
                      data-testid="login-password-input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="pl-9 h-11 rounded-lg bg-zinc-900/60 border-white/5 font-mono text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  data-testid="login-credentials-btn"
                  disabled={busy}
                  className="w-full h-12 btn-primary-modern flex items-center justify-center gap-2 text-sm font-semibold tracking-tight"
                >
                  {busy ? "signing in…" : "Sign in"}
                  <ArrowRight size={16} weight="bold" className="opacity-80" />
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <div className="flex-1 h-px bg-white/5" />
                <span className="eyebrow">or</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

              <div className="space-y-3">
                <button
                  data-testid="login-google-btn"
                  onClick={loginGoogle}
                  disabled={busy}
                  className="w-full h-11 btn-ghost-modern flex items-center justify-center gap-3 text-xs font-semibold"
                >
                  <GoogleLogo size={18} weight="bold" />
                  Continue with Google
                </button>

                {!showAlt ? (
                  <button
                    onClick={() => setShowAlt(true)}
                    data-testid="show-wallet-options-btn"
                    className="w-full text-xs font-mono text-zinc-500 hover:text-sky-400 transition py-2"
                  >
                    + wallet options (MetaMask / new wallet)
                  </button>
                ) : (
                  <>
                    <button
                      data-testid="login-metamask-btn"
                      onClick={() => handle(loginMetaMask, "MetaMask")}
                      disabled={busy}
                      className="w-full h-11 btn-ghost-modern flex items-center justify-center gap-3 text-xs font-semibold"
                    >
                      <Wallet size={18} weight="duotone" className="text-sky-400" />
                      Connect MetaMask
                    </button>
                    <button
                      data-testid="login-demo-btn"
                      onClick={() => handle(loginDemo, "Demo wallet")}
                      disabled={busy}
                      className="w-full h-11 btn-ghost-modern flex items-center justify-center gap-3 text-xs font-semibold"
                    >
                      <Lightning size={18} weight="duotone" className="text-cyan-300" />
                      Generate new wallet
                    </button>
                    <div className="text-[10px] font-mono text-zinc-500 leading-relaxed pt-1">
                      New wallets must complete onboarding to bind a username/password.
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        <div className="border-t border-white/5 pt-5 flex flex-col sm:flex-row justify-between gap-2 text-xs text-zinc-500 font-mono">
          <div>Gen C // decentralized medical records protocol</div>
          <div className="flex gap-4 items-center">
            <a href="/verify" data-testid="footer-verify-link" className="hover:text-sky-400 transition">verify a certificate →</a>
            <span>EVM Permissioned Ledger · IPFS · QBFT · LPA</span>
          </div>
        </div>
      </div>
    </div>
  );
}
