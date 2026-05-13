import { useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Hash } from "@/components/CryptoString";
import { UserCircle, Stethoscope, ArrowRight, ShieldCheck } from "@phosphor-icons/react";

export default function Onboarding() {
  const { session, refresh, buildSig, logout } = useWallet();
  const nav = useNavigate();
  const [role, setRole] = useState(null);
  const [name, setName] = useState(session?.name || "");
  const [department, setDepartment] = useState("");
  const [hospital, setHospital] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session) {
    nav("/");
    return null;
  }
  if (session.role && session.role !== "unregistered") {
    nav("/dashboard");
    return null;
  }

  const submit = async () => {
    if (!role) return toast.error("Pick a role");
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      let payload = {
        actor_address: session.address,
        role,
        name,
        department: role === "doctor" ? department || "General Medicine" : null,
        hospital: role === "doctor" ? hospital || null : null,
      };
      if (session.auth !== "google") {
        const { message, signature } = await buildSig("self-register");
        payload.actor_signature = signature;
        payload.actor_message = message;
      }
      const r = await api.post("/users/register", payload);
      toast.success("Profile created", { description: r.data.did });
      await refresh();
      setTimeout(() => nav("/dashboard"), 250);
    } catch (e) {
      toast.error("Registration failed", { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-mesh relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-soft pointer-events-none" />
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[34rem] h-[34rem] rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-6 py-12 lg:py-20">
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-400 flex items-center justify-center shadow-glow">
              <ShieldCheck size={20} weight="bold" className="text-zinc-950" />
            </div>
            <div className="font-display font-bold text-xl">Gen C</div>
          </div>
          <button onClick={async () => { await logout(); nav("/"); }} className="text-xs font-mono text-zinc-500 hover:text-emerald-400" data-testid="onb-logout">cancel</button>
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="eyebrow mb-3">step 02 // complete profile</div>
          <h1 className="heading-display text-4xl sm:text-5xl font-bold mb-3">Who are you on the network?</h1>
          <p className="text-zinc-400 max-w-xl">Your wallet is the cryptographic identity. Tell us your role so we can wire the right portal.</p>

          <div className="mt-6 glass rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            {session.picture && <img src={session.picture} alt="" className="w-10 h-10 rounded-full" />}
            <div className="flex-1">
              {session.email && <div className="text-sm font-medium">{session.name || session.email}</div>}
              <div className="mt-1"><Hash value={session.address} label="wallet" testId="onb-wallet" /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {[
              { id: "patient", icon: UserCircle, label: "Patient", desc: "Own your medical history. Approve or deny doctor access via wallet signature." },
              { id: "doctor", icon: Stethoscope, label: "Doctor", desc: "Upload encrypted records, request patient history, anchor to LPA batch." },
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                data-testid={`role-${r.id}-btn`}
                className={`card-modern p-5 text-left transition hover:border-emerald-400/50 ${
                  role === r.id ? "border-emerald-400/80 shadow-glow" : ""
                }`}
              >
                <r.icon size={32} weight="duotone" className={role === r.id ? "text-emerald-400" : "text-zinc-400"} />
                <div className="mt-3 font-display font-bold text-xl">{r.label}</div>
                <div className="text-sm text-zinc-400 mt-1">{r.desc}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            <div>
              <Label className="eyebrow">full name</Label>
              <Input
                data-testid="onb-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 rounded-lg bg-zinc-900/60 border-white/5 font-mono"
                placeholder="Maria Dela Cruz"
              />
            </div>
            {role === "doctor" && (
              <div>
                <Label className="eyebrow">department</Label>
                <Input
                  data-testid="onb-dept-input"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="mt-2 rounded-lg bg-zinc-900/60 border-white/5 font-mono"
                  placeholder="Cardiology, Pediatrics…"
                />
              </div>
            )}
            {role === "doctor" && (
              <div className="sm:col-span-2">
                <Label className="eyebrow">hospital / clinic</Label>
                <Input
                  data-testid="onb-hospital-input"
                  value={hospital}
                  onChange={(e) => setHospital(e.target.value)}
                  className="mt-2 rounded-lg bg-zinc-900/60 border-white/5 font-mono"
                  placeholder="St. Luke's Medical Center, Makati Med…"
                />
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={busy || !role || !name}
            data-testid="onb-submit-btn"
            className="mt-8 h-12 px-7 btn-primary-modern flex items-center justify-center gap-3 text-sm font-semibold"
          >
            {busy ? "Creating identity…" : "Create my DID"}
            <ArrowRight size={16} weight="bold" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}
