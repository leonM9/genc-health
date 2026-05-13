import { useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Wallet, Lightning, ShieldCheck, Cube, Fingerprint, Lock } from "@phosphor-icons/react";

export default function Login() {
  const { loginDemo, loginAsAdmin, loginMetaMask, loginWithPrivateKey, adminInfo, session } = useWallet();
  const [pk, setPk] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  if (session) {
    nav("/dashboard");
  }

  const handle = async (fn) => {
    setBusy(true);
    try {
      const s = await fn();
      toast.success(`Authenticated as ${s.role.toUpperCase()}`, {
        description: s.role === "unregistered" ? "Wallet not registered. Ask admin to register you." : s.address,
      });
      setTimeout(() => nav("/dashboard"), 400);
    } catch (e) {
      toast.error("Sign-in failed", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 grid-bg relative overflow-hidden">
      {/* Hero background image */}
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1746470427586-66ed7b83a502?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2Mzl8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMGRhcmslMjBncmVlbiUyMG5lb24lMjBncmlkJTIwbWF0cml4JTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzg2NjgxNjl8MA&ixlib=rb-4.1.0&q=85')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#09090b]/40 to-[#09090b]" />

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-10 lg:py-16">
        {/* Top bar */}
        <div className="flex justify-between items-center mb-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border border-terminal/60 flex items-center justify-center">
              <ShieldCheck size={22} weight="bold" className="text-terminal" />
            </div>
            <div className="leading-none">
              <div className="font-display font-bold text-2xl tracking-tighter">GEN_C</div>
              <div className="label-eyebrow mt-1">v0.1 // prototype</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 label-eyebrow">
            <span className="w-2 h-2 bg-terminal animate-pulse-terminal rounded-full" />
            <span>network online</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          {/* Left: narrative */}
          <motion.div
            className="lg:col-span-7"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="label-eyebrow mb-4">decentralized medical records // ra 10173 compliant</div>
            <h1 className="heading-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black leading-[0.95] tracking-tighter">
              your<br />
              health,<br />
              <span className="text-terminal">your keys.</span>
            </h1>
            <p className="mt-8 max-w-xl text-zinc-400 leading-relaxed">
              Hybrid AES-256 + CP-ABE encryption. Layered Proof Aggregation
              anchors hashes to a private Hyperledger Besu chain. No plaintext
              ever touches the ledger or the database.
            </p>

            <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 border border-zinc-800 max-w-xl">
              {[
                { icon: Lock, label: "AES-256-GCM", k: "PAYLOAD" },
                { icon: Fingerprint, label: "CP-ABE", k: "POLICY" },
                { icon: Cube, label: "IPFS / Pinata", k: "STORAGE" },
                { icon: ShieldCheck, label: "Merkle Anchor", k: "LEDGER" },
              ].map((it) => (
                <div key={it.k} className="bg-[#09090b] p-4">
                  <it.icon size={18} weight="bold" className="text-terminal mb-2" />
                  <div className="label-eyebrow">{it.k}</div>
                  <div className="text-xs font-mono mt-1 text-zinc-200">{it.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right: sign-in */}
          <motion.div
            className="lg:col-span-5"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            <div className="border border-zinc-800 bg-[#0c0c0e]/95 backdrop-blur p-6 sm:p-8">
              <div className="label-eyebrow mb-2">step 01</div>
              <div className="heading-display text-2xl font-semibold mb-1">Sign-In with Ethereum</div>
              <div className="text-xs text-zinc-500 mb-6 font-mono">No password. Just a wallet signature.</div>

              <div className="space-y-3">
                <Button
                  data-testid="login-metamask-btn"
                  onClick={() => handle(loginMetaMask)}
                  disabled={busy}
                  className="w-full rounded-none bg-terminal text-black font-mono font-bold uppercase tracking-widest text-sm hover:bg-[#00cc33] h-12"
                >
                  <Wallet size={18} weight="bold" className="mr-2" />
                  Connect MetaMask
                </Button>
                <Button
                  data-testid="login-demo-btn"
                  onClick={() => handle(loginDemo)}
                  disabled={busy}
                  variant="outline"
                  className="w-full rounded-none border-zinc-700 text-zinc-200 font-mono uppercase tracking-widest text-sm hover:bg-zinc-900 hover:text-terminal h-12"
                >
                  <Lightning size={18} weight="bold" className="mr-2" />
                  Create Demo Wallet
                </Button>
                <Button
                  data-testid="login-admin-btn"
                  onClick={() => handle(loginAsAdmin)}
                  disabled={busy || !adminInfo}
                  variant="outline"
                  className="w-full rounded-none border-amber/40 text-amber font-mono uppercase tracking-widest text-sm hover:bg-amber/10 h-12"
                >
                  <ShieldCheck size={18} weight="bold" className="mr-2" />
                  Sign-in as Admin
                </Button>
              </div>

              <div className="mt-6 pt-6 border-t border-zinc-800">
                <div className="label-eyebrow mb-2">import existing</div>
                <div className="flex gap-2">
                  <Input
                    data-testid="login-pk-input"
                    placeholder="0x... private key"
                    value={pk}
                    onChange={(e) => setPk(e.target.value)}
                    className="rounded-none bg-[#09090b] border-zinc-800 font-mono text-xs"
                  />
                  <Button
                    data-testid="login-pk-btn"
                    onClick={() => handle(() => loginWithPrivateKey(pk))}
                    disabled={busy || !pk}
                    className="rounded-none bg-zinc-800 hover:bg-zinc-700 text-white font-mono uppercase text-xs"
                  >
                    sign
                  </Button>
                </div>
              </div>

              {adminInfo && (
                <div className="mt-6 pt-6 border-t border-zinc-800">
                  <div className="label-eyebrow mb-2 text-amber">admin wallet :: thesis demo only</div>
                  <div className="crypto-text text-[10px] break-all" data-testid="admin-address-display">
                    {adminInfo.address}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
