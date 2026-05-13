import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import MerkleVisualizer from "@/components/MerkleVisualizer";
import LpaCostChart from "@/components/LpaCostChart";
import { merklePreview, aesEncryptFile, generateAesKey, exportKeyB64, buildPolicy, shortAddr } from "@/lib/crypto";
import { ethers } from "ethers";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Cube, ArrowsClockwise, Anchor, Users, TreeStructure, Stack, Stethoscope, UserCircle, UserPlus, UploadSimple, FileLock, ShieldStar, CloudArrowUp, Sparkle, Copy, Lightning, Trash } from "@phosphor-icons/react";

const STAGE_ICONS = { encrypting: FileLock, uploading: CloudArrowUp, policy: ShieldStar, enqueue: TreeStructure, done: Anchor };

export default function AdminDashboard() {
  const { session, buildSig } = useWallet();
  const [users, setUsers] = useState([]);
  const [pending, setPending] = useState([]);
  const [anchors, setAnchors] = useState([]);
  const [stats, setStats] = useState({});
  const [preview, setPreview] = useState({ root: "", layers: [] });
  const [anchoring, setAnchoring] = useState(false);

  // Register Doctor form
  const [docForm, setDocForm] = useState({ address: "", name: "", department: "", hospital: "" });
  const [docGenPk, setDocGenPk] = useState(null);

  // Register Patient form
  const [patForm, setPatForm] = useState({ address: "", name: "" });
  const [patGenPk, setPatGenPk] = useState(null);

  // Upload record form
  const [upForm, setUpForm] = useState({ patient: "", diagnosis: "", notes: "" });
  const [upFile, setUpFile] = useState(null);
  const [pipeline, setPipeline] = useState([]);

  const load = async () => {
    const [u, p, a, s] = await Promise.all([
      api.get("/users"), api.get("/lpa/pending"), api.get("/lpa/anchors"), api.get("/lpa/stats"),
    ]);
    setUsers(u.data); setPending(p.data); setAnchors(a.data); setStats(s.data);
    setPreview(p.data.length ? merklePreview(p.data.map((x) => x.cid)) : { root: "", layers: [] });
  };
  useEffect(() => { load(); }, []);

  const doctors = users.filter((u) => u.role === "doctor");
  const patients = users.filter((u) => u.role === "patient");

  const anchor = async () => {
    setAnchoring(true);
    try {
      const { message, signature } = await buildSig("anchor-merkle-root");
      const r = await api.post("/lpa/anchor", { admin_address: session.address, signature, message });
      toast.success("Merkle root anchored", { description: r.data.root.slice(0, 22) + "…" });
      load();
    } catch (e) {
      toast.error("Anchor failed", { description: e?.response?.data?.detail || e.message });
    } finally { setAnchoring(false); }
  };

  const [simulating, setSimulating] = useState(false);
  const simulate = async (count = 10) => {
    setSimulating(true);
    try {
      const { message, signature } = await buildSig("simulate-lpa-batch");
      const r = await api.post("/lpa/simulate", { admin_address: session.address, signature, message, count });
      toast.success(`+${r.data.inserted} synthetic records queued`, { description: "Watch the cost chart update" });
      load();
    } catch (e) {
      toast.error("Simulate failed", { description: e?.response?.data?.detail || e.message });
    } finally { setSimulating(false); }
  };

  const clearSim = async () => {
    try {
      const { message, signature } = await buildSig("clear-sim-records");
      const r = await api.post("/lpa/clear-simulated", { admin_address: session.address, signature, message, count: 0 });
      toast.success(`Cleared ${r.data.removed_pending} simulated records`);
      load();
    } catch (e) {
      toast.error("Clear failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const generateWallet = (kind) => {
    const w = ethers.Wallet.createRandom();
    if (kind === "doctor") {
      setDocForm((f) => ({ ...f, address: w.address }));
      setDocGenPk(w.privateKey);
    } else {
      setPatForm((f) => ({ ...f, address: w.address }));
      setPatGenPk(w.privateKey);
    }
    toast.success("Wallet generated", { description: "Save the private key — it won't be shown again" });
  };

  const adminRegister = async (kind) => {
    const form = kind === "doctor" ? docForm : patForm;
    if (!form.address || !form.name) return toast.error("Address & name required");
    try {
      const { message, signature } = await buildSig(`admin-register-${kind}`);
      await api.post("/users/admin-register", {
        admin_address: session.address,
        admin_signature: signature,
        admin_message: message,
        target_address: form.address,
        role: kind,
        name: form.name,
        department: kind === "doctor" ? (form.department || "General Medicine") : null,
        hospital: kind === "doctor" ? (form.hospital || null) : null,
      });
      toast.success(`${kind} registered`, { description: form.name });
      if (kind === "doctor") setDocForm({ address: "", name: "", department: "", hospital: "" });
      else setPatForm({ address: "", name: "" });
      load();
    } catch (e) {
      toast.error("Registration failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const upPipeline = (stage, status, label) => {
    setPipeline((p) => {
      const idx = p.findIndex((s) => s.stage === stage);
      if (idx === -1) return [...p, { stage, status, label }];
      const cp = [...p]; cp[idx] = { stage, status, label }; return cp;
    });
  };

  const adminUpload = async () => {
    if (!upForm.patient) return toast.error("Pick a patient");
    if (!upFile) return toast.error("Pick a file");
    if (!upForm.diagnosis) return toast.error("Diagnosis required");
    setPipeline([]);
    try {
      const patient = patients.find((p) => p.address === upForm.patient);
      upPipeline("encrypting", "active", "Generating AES-256-GCM key & encrypting payload…");
      const key = await generateAesKey();
      const encrypted = await aesEncryptFile(upFile, key);
      const keyB64 = await exportKeyB64(key);
      upPipeline("encrypting", "done", "Payload encrypted (AES-256-GCM)");

      upPipeline("uploading", "active", "Pinning encrypted blob to IPFS via Pinata…");
      const fd = new FormData(); fd.append("file", encrypted, upFile.name + ".enc");
      const up = await api.post("/ipfs/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      upPipeline("uploading", "done", `IPFS CID :: ${up.data.cid.slice(0, 14)}…`);

      upPipeline("policy", "active", "Wrapping AES key under CP-ABE policy…");
      const policy = buildPolicy({ patientAddress: patient.address, doctorDepartment: "Admin" });
      upPipeline("policy", "done", policy);

      upPipeline("enqueue", "active", "Submitting to LPA pending batch…");
      const { message, signature } = await buildSig("admin-upload-record");
      const r = await api.post("/records", {
        uploader_address: session.address, uploader_signature: signature, uploader_message: message,
        patient_address: patient.address, cid: up.data.cid, file_name: upFile.name, file_size: upFile.size,
        encrypted_key_b64: keyB64, policy, diagnosis: upForm.diagnosis, notes: upForm.notes,
      });
      upPipeline("enqueue", "done", "Queued for next Merkle anchor");
      upPipeline("done", "done", `Record id :: ${r.data.id.slice(0, 8)}…`);
      toast.success("Record attached to patient", { description: patient.name });
      setUpFile(null); setUpForm({ patient: "", diagnosis: "", notes: "" });
      load();
    } catch (e) {
      toast.error("Upload failed", { description: e?.response?.data?.detail || e.message });
      upPipeline("error", "error", e.message);
    }
  };

  const copyText = (t) => { navigator.clipboard.writeText(t); toast.success("Copied"); };

  const statCards = [
    { k: "Doctors", v: doctors.length, color: "text-cyan-300", icon: Stethoscope },
    { k: "Patients", v: patients.length, color: "text-sky-400", icon: UserCircle },
    { k: "Pending CIDs", v: stats.pending || 0, color: "text-amber", icon: Cube },
    { k: "Anchored Roots", v: stats.anchors || 0, color: "text-sky-400", icon: TreeStructure },
  ];

  return (
    <Layout role="admin // network control" title="Network Control Room" subtitle="Register users, attach medical files to patients, and anchor LPA Merkle batches to the chain.">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {statCards.map((s) => (
          <motion.div key={s.k} className="stat-card p-5" whileHover={{ y: -2 }}>
            <s.icon size={20} weight="duotone" className={`${s.color} mb-3 opacity-80`} />
            <div className="eyebrow">{s.k}</div>
            <div className={`font-display font-bold text-4xl mt-1 ${s.color}`} data-testid={`stat-${s.k.toLowerCase().replace(" ", "-")}`}>{s.v}</div>
          </motion.div>
        ))}
      </div>

      <Tabs defaultValue="lpa">
        <TabsList className="bg-zinc-900/60 border border-white/5 rounded-xl p-1 mb-6 flex-wrap">
          {[
            { v: "lpa", l: "LPA Batch", i: Cube },
            { v: "upload", l: "Attach File", i: UploadSimple },
            { v: "register-doctor", l: "Register Doctor", i: Stethoscope },
            { v: "register-patient", l: "Register Patient", i: UserPlus },
            { v: "anchors", l: "Anchored Roots", i: Anchor },
            { v: "doctors", l: `Doctors (${doctors.length})`, i: Users },
            { v: "patients", l: `Patients (${patients.length})`, i: UserCircle },
          ].map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}
              className="rounded-lg font-medium text-xs uppercase tracking-wider data-[state=active]:bg-sky-500 data-[state=active]:text-zinc-950 data-[state=active]:shadow-glow px-5 py-2">
              <t.i size={14} weight="bold" className="mr-2" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* LPA Batch (with cost viz) */}
        <TabsContent value="lpa">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
            <div className="card-modern p-6 lg:col-span-2">
              <div className="eyebrow mb-1">step 01 // collect</div>
              <h3 className="heading-display text-2xl font-bold mb-4">Pending Batch</h3>
              <p className="text-zinc-400 text-sm mb-6">CIDs waiting to be hashed into the next Merkle root.</p>
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-2">
                {pending.length === 0 && <div className="text-zinc-500 font-mono text-sm py-10 text-center rounded-lg border border-dashed border-white/10">queue empty</div>}
                {pending.map((p) => (
                  <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    className="rounded-lg border border-white/5 bg-zinc-900/40 p-3" data-testid={`lpa-pending-${p.cid}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Checkbox checked disabled className="rounded border-sky-400 data-[state=checked]:bg-sky-400 data-[state=checked]:text-zinc-950" />
                      <span className="eyebrow !text-amber">queued</span>
                      <span className="text-zinc-500 text-[10px] font-mono ml-auto">{p.added_at?.slice(11, 19)}</span>
                    </div>
                    <Hash value={p.cid} label="cid" testId={`pending-cid-${p.cid}`} />
                    {p.patient_name && (
                      <div className="text-[11px] font-mono text-zinc-400 mt-2">
                        {p.uploader_name} → <span className="text-zinc-200">{p.patient_name}</span>
                        <span className="text-zinc-600"> · {p.diagnosis}</span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
              <button onClick={anchor} disabled={pending.length === 0 || anchoring} data-testid="anchor-merkle-btn"
                className="btn-primary-modern w-full h-12 mt-6 flex items-center justify-center gap-2 text-sm font-semibold">
                <Anchor size={16} weight="bold" />
                {anchoring ? "Anchoring…" : `Anchor Merkle Root (${pending.length})`}
              </button>

              {/* LPA Simulator */}
              <div className="mt-4 rounded-lg border border-cyan-300/30 bg-cyan-300/5 p-4" data-testid="lpa-simulator">
                <div className="flex items-center gap-2 mb-2">
                  <Lightning size={16} weight="duotone" className="text-cyan-300" />
                  <div className="eyebrow text-cyan-300">demo simulator</div>
                </div>
                <p className="text-xs text-zinc-400 mb-3">Inject synthetic patient records into the pending batch to demo how per-record cost drops in real time.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => simulate(10)} disabled={simulating}
                    data-testid="simulate-10-btn"
                    className="h-10 rounded-lg border border-cyan-300/40 bg-cyan-300/10 text-cyan-200 font-mono uppercase text-[11px] hover:bg-cyan-300/15 transition flex items-center justify-center gap-2">
                    <Sparkle size={12} weight="bold" />{simulating ? "..." : "+10 patients"}
                  </button>
                  <button onClick={() => simulate(50)} disabled={simulating}
                    data-testid="simulate-50-btn"
                    className="h-10 rounded-lg border border-cyan-300/40 bg-cyan-300/10 text-cyan-200 font-mono uppercase text-[11px] hover:bg-cyan-300/15 transition flex items-center justify-center gap-2">
                    <Sparkle size={12} weight="bold" />{simulating ? "..." : "+50 patients"}
                  </button>
                </div>
                <button onClick={clearSim} data-testid="clear-sim-btn"
                  className="mt-2 w-full h-8 rounded-lg border border-rose/30 bg-rose/5 text-rose/90 font-mono uppercase text-[10px] hover:bg-rose/10 transition flex items-center justify-center gap-2">
                  <Trash size={11} weight="bold" />clear simulated
                </button>
              </div>
            </div>

            <div className="card-modern p-6 lg:col-span-3">
              <div className="eyebrow mb-1">step 02 // aggregate</div>
              <h3 className="heading-display text-2xl font-bold mb-4">Merkle Tree Preview</h3>
              <MerkleVisualizer layers={preview.layers} root={preview.root} />
            </div>
          </div>

          {/* Cost savings visualization */}
          <LpaCostChart batchSize={pending.length} totalAnchored={(anchors || []).reduce((a, x) => a + (x.leaf_count || 0), 0)} />
        </TabsContent>

        {/* Attach File */}
        <TabsContent value="upload">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="card-modern p-6 lg:col-span-2">
              <div className="eyebrow mb-1">attach to patient</div>
              <h3 className="heading-display text-xl font-bold mb-4">Upload Medical File</h3>
              <p className="text-zinc-400 text-sm mb-4">Admin uploads on behalf — encrypted with AES-256, pinned to IPFS via Pinata, then queued for the next Merkle anchor. Patient's dashboard updates immediately.</p>

              <div className="space-y-4">
                <div>
                  <Label className="eyebrow">patient</Label>
                  <Select value={upForm.patient} onValueChange={(v) => setUpForm({ ...upForm, patient: v })}>
                    <SelectTrigger data-testid="up-patient-select" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5">
                      <SelectValue placeholder="select a registered patient" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg bg-zinc-900 border-white/10 max-h-[280px]">
                      {patients.length === 0 && <SelectItem disabled value="none">no patients yet</SelectItem>}
                      {patients.map((p) => (
                        <SelectItem key={p.address} value={p.address}>
                          {p.name} · {p.did}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="eyebrow">diagnosis / title</Label>
                  <Input data-testid="up-diag-input" value={upForm.diagnosis} onChange={(e) => setUpForm({ ...upForm, diagnosis: e.target.value })}
                    placeholder="e.g. Annual physical exam" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>
                <div>
                  <Label className="eyebrow">notes</Label>
                  <Textarea data-testid="up-notes-input" rows={3} value={upForm.notes} onChange={(e) => setUpForm({ ...upForm, notes: e.target.value })}
                    className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>
                <div>
                  <Label className="eyebrow">file</Label>
                  <Input data-testid="up-file-input" type="file" onChange={(e) => setUpFile(e.target.files?.[0] || null)}
                    className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5 file:bg-sky-500/20 file:text-sky-300 file:border-0 file:px-3 file:py-1 file:mr-3 file:rounded-md file:font-mono file:text-[10px] file:uppercase" />
                  {upFile && <div className="text-[10px] text-zinc-500 font-mono mt-1">{upFile.name} · {(upFile.size / 1024).toFixed(1)} KB</div>}
                </div>
                <button onClick={adminUpload} disabled={!upForm.patient || !upFile || !upForm.diagnosis}
                  data-testid="admin-upload-btn"
                  className="btn-primary-modern w-full h-12 flex items-center justify-center gap-2 text-sm font-semibold">
                  <UploadSimple size={16} weight="bold" />Encrypt & Attach
                </button>
              </div>
            </div>

            <div className="card-modern p-6 lg:col-span-3">
              <div className="eyebrow mb-1">cryptographic pipeline</div>
              <h3 className="heading-display text-xl font-bold mb-4">Live Encryption Pipeline</h3>
              <div className="space-y-2">
                <AnimatePresence>
                  {pipeline.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/10 p-14 text-center text-zinc-500 font-mono text-xs">
                      pipeline idle // awaiting submission
                    </div>
                  )}
                  {pipeline.map((s, i) => {
                    const Icon = STAGE_ICONS[s.stage] || FileLock;
                    const tone = s.status === "active" ? "border-amber/40 bg-amber/5"
                      : s.status === "done" ? "border-sky-400/30 bg-sky-500/5"
                      : s.status === "error" ? "border-rose/40 bg-rose/5" : "border-white/5";
                    const iconColor = s.status === "active" ? "text-amber animate-pulse"
                      : s.status === "done" ? "text-sky-400"
                      : s.status === "error" ? "text-rose" : "text-zinc-500";
                    return (
                      <motion.div key={s.stage} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className={`rounded-lg border p-3 flex items-start gap-3 ${tone}`} data-testid={`admin-pipeline-${s.stage}`}>
                        <Icon size={20} weight="duotone" className={iconColor} />
                        <div className="flex-1 min-w-0">
                          <div className="eyebrow flex justify-between">
                            <span>{s.stage}</span>
                            <span className={iconColor.replace("animate-pulse", "")}>{s.status}</span>
                          </div>
                          <div className="font-mono text-xs text-zinc-300 mt-1 break-all">{s.label}</div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Register Doctor */}
        <TabsContent value="register-doctor">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-modern p-6">
              <div className="eyebrow mb-1">in-clinic onboarding</div>
              <h3 className="heading-display text-xl font-bold mb-4">Register a Doctor</h3>
              <div className="space-y-4">
                <div>
                  <Label className="eyebrow">wallet address</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input data-testid="doc-addr-input" placeholder="0x…" value={docForm.address} onChange={(e) => setDocForm({ ...docForm, address: e.target.value })}
                      className="rounded-lg bg-zinc-900/60 border-white/5 font-mono text-xs" />
                    <Button data-testid="doc-gen-wallet-btn" onClick={() => generateWallet("doctor")} className="rounded-lg btn-ghost-modern h-10 px-3 text-xs">
                      <Sparkle size={14} weight="bold" className="mr-1" />Generate
                    </Button>
                  </div>
                  {docGenPk && (
                    <div className="mt-2 p-3 rounded-lg border border-amber/30 bg-amber/5">
                      <div className="eyebrow text-amber mb-1 flex justify-between">
                        <span>private key — send to doctor securely</span>
                        <button onClick={() => copyText(docGenPk)} className="text-amber hover:text-sky-400"><Copy size={12} weight="bold" /></button>
                      </div>
                      <div className="crypto-text text-[10px]">{docGenPk}</div>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="eyebrow">full name</Label>
                  <Input data-testid="doc-name-input" value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                    placeholder="Dr. Juan Dela Cruz" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>
                <div>
                  <Label className="eyebrow">department</Label>
                  <Input data-testid="doc-dept-input" value={docForm.department} onChange={(e) => setDocForm({ ...docForm, department: e.target.value })}
                    placeholder="Cardiology" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>
                <div>
                  <Label className="eyebrow">hospital / clinic</Label>
                  <Input data-testid="doc-hosp-input" value={docForm.hospital} onChange={(e) => setDocForm({ ...docForm, hospital: e.target.value })}
                    placeholder="St. Luke's Medical Center" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>
                <button onClick={() => adminRegister("doctor")} data-testid="doc-register-submit"
                  className="btn-primary-modern w-full h-12 flex items-center justify-center gap-2 text-sm font-semibold">
                  <Stethoscope size={16} weight="bold" />Register Doctor
                </button>
              </div>
            </div>

            <div className="card-modern p-6">
              <div className="eyebrow mb-2">also note</div>
              <h3 className="heading-display text-lg font-bold mb-3">Doctors can also self-register</h3>
              <p className="text-sm text-zinc-400">Doctors who have a Google or MetaMask wallet can sign up themselves from the login page → onboarding screen. Use this form only for in-clinic onboarding where the admin enrolls staff directly.</p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-white/5 bg-zinc-900/40">
                  <div className="eyebrow">self-register</div>
                  <div className="mt-2 text-zinc-300">Doctor controls their wallet from day one. Strongest privacy.</div>
                </div>
                <div className="p-3 rounded-lg border border-sky-400/30 bg-sky-500/5">
                  <div className="eyebrow text-sky-300">admin-register</div>
                  <div className="mt-2 text-zinc-200">Faster onboarding. Admin generates a wallet and hands the private key to the doctor.</div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Register Patient */}
        <TabsContent value="register-patient">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-modern p-6">
              <div className="eyebrow mb-1">in-clinic onboarding</div>
              <h3 className="heading-display text-xl font-bold mb-4">Register a Patient</h3>
              <div className="space-y-4">
                <div>
                  <Label className="eyebrow">wallet address</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input data-testid="pat-addr-input" placeholder="0x…" value={patForm.address} onChange={(e) => setPatForm({ ...patForm, address: e.target.value })}
                      className="rounded-lg bg-zinc-900/60 border-white/5 font-mono text-xs" />
                    <Button data-testid="pat-gen-wallet-btn" onClick={() => generateWallet("patient")} className="rounded-lg btn-ghost-modern h-10 px-3 text-xs">
                      <Sparkle size={14} weight="bold" className="mr-1" />Generate
                    </Button>
                  </div>
                  {patGenPk && (
                    <div className="mt-2 p-3 rounded-lg border border-amber/30 bg-amber/5">
                      <div className="eyebrow text-amber mb-1 flex justify-between">
                        <span>private key — send to patient securely</span>
                        <button onClick={() => copyText(patGenPk)} className="text-amber hover:text-sky-400"><Copy size={12} weight="bold" /></button>
                      </div>
                      <div className="crypto-text text-[10px]">{patGenPk}</div>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="eyebrow">full name</Label>
                  <Input data-testid="pat-name-input" value={patForm.name} onChange={(e) => setPatForm({ ...patForm, name: e.target.value })}
                    placeholder="Maria Dela Cruz" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>
                <button onClick={() => adminRegister("patient")} data-testid="pat-register-submit"
                  className="btn-primary-modern w-full h-12 flex items-center justify-center gap-2 text-sm font-semibold">
                  <UserPlus size={16} weight="bold" />Register Patient
                </button>
              </div>
            </div>

            <div className="card-modern p-6">
              <div className="eyebrow mb-2">workflow</div>
              <h3 className="heading-display text-lg font-bold mb-3">After registration</h3>
              <ol className="text-sm text-zinc-300 space-y-3 list-decimal pl-4">
                <li>The patient receives their wallet credentials privately.</li>
                <li>You can immediately attach medical files via the <span className="text-sky-300 font-medium">"Attach File"</span> tab.</li>
                <li>When the patient logs in with their wallet, they'll see all attached records, encrypted under <span className="text-sky-300 font-medium">their</span> key.</li>
                <li>They can request additional uploads from doctors directly.</li>
              </ol>
            </div>
          </div>
        </TabsContent>

        {/* Anchors */}
        <TabsContent value="anchors">
          <div className="flex justify-between items-center mb-5">
            <div>
              <div className="eyebrow mb-1">on-chain provenance</div>
              <h3 className="heading-display text-2xl font-bold">Anchored Merkle Roots</h3>
            </div>
            <Button onClick={load} variant="ghost" data-testid="refresh-anchors-btn" className="rounded-lg text-zinc-400 hover:text-sky-400 font-mono text-xs">
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> refresh
            </Button>
          </div>
          {anchors.length === 0 ? (
            <div className="card-modern p-16 text-center text-zinc-500 font-mono text-sm" data-testid="anchors-empty">
              <Anchor size={36} weight="duotone" className="mx-auto mb-3 text-zinc-700" />
              No anchors yet — queue records then click <span className="text-sky-300">Anchor Merkle Root</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {anchors.map((a) => (
                <motion.div key={a.id} className="card-modern p-5 hover:border-sky-400/40 transition" whileHover={{ y: -2 }}
                  data-testid={`anchor-card-${a.block_number}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Anchor size={20} weight="duotone" className="text-sky-400" />
                      <div>
                        <div className="eyebrow !text-[9px]">block</div>
                        <div className="font-display font-bold text-2xl text-sky-400 leading-none">#{a.block_number}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="eyebrow !text-[9px]">leaves</div>
                      <div className="font-display font-bold text-xl text-cyan-300">{a.leaf_count}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Hash value={a.root} label="root" testId={`root-${a.id}`} />
                    <Hash value={a.tx_hash} label="tx" testId={`tx-${a.id}`} />
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/5 flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>anchored</span>
                    <span>{new Date(a.anchored_at).toLocaleString()}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Doctors */}
        <TabsContent value="doctors">
          <div className="flex justify-between items-center mb-5">
            <div>
              <div className="eyebrow mb-1">network members</div>
              <h3 className="heading-display text-2xl font-bold">Registered Doctors ({doctors.length})</h3>
            </div>
            <Button onClick={load} variant="ghost" data-testid="refresh-doctors-btn" className="rounded-lg text-zinc-400 hover:text-sky-400 font-mono text-xs">
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> refresh
            </Button>
          </div>
          {doctors.length === 0 ? (
            <div className="card-modern p-16 text-center text-zinc-500 font-mono text-sm" data-testid="doctors-empty">
              <Stethoscope size={36} weight="duotone" className="mx-auto mb-3 text-zinc-700" />
              No registered doctors yet — use the <span className="text-sky-300">Register Doctor</span> tab
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {doctors.map((u) => (
                <motion.div key={u.address} className="card-modern p-5 hover:border-cyan-300/40 transition" whileHover={{ y: -2 }}
                  data-testid={`doctor-row-${u.address_lower}`}>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400/20 to-sky-500/20 border border-cyan-300/30 flex items-center justify-center shrink-0">
                      <Stethoscope size={22} weight="duotone" className="text-cyan-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-lg leading-tight truncate">{u.name}</div>
                      <div className="text-xs text-zinc-400 mt-0.5 truncate">{u.department || "—"}</div>
                      {u.hospital && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{u.hospital}</div>}
                    </div>
                    <StatusBadge status="doctor" />
                  </div>
                  <div className="space-y-2">
                    <Hash value={u.did} label="did" testId={`d-did-${u.address_lower}`} />
                    <Hash value={u.address} label="wallet" testId={`d-addr-${u.address_lower}`} />
                  </div>
                  <div className="mt-3 text-[10px] text-zinc-600 font-mono">joined · {u.created_at?.slice(0, 10)}</div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Patients */}
        <TabsContent value="patients">
          <div className="flex justify-between items-center mb-5">
            <div>
              <div className="eyebrow mb-1">network members</div>
              <h3 className="heading-display text-2xl font-bold">Registered Patients ({patients.length})</h3>
            </div>
            <Button onClick={load} variant="ghost" data-testid="refresh-patients-btn" className="rounded-lg text-zinc-400 hover:text-sky-400 font-mono text-xs">
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> refresh
            </Button>
          </div>
          {patients.length === 0 ? (
            <div className="card-modern p-16 text-center text-zinc-500 font-mono text-sm" data-testid="patients-empty">
              <UserCircle size={36} weight="duotone" className="mx-auto mb-3 text-zinc-700" />
              No registered patients yet — use the <span className="text-sky-300">Register Patient</span> tab
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {patients.map((u) => (
                <motion.div key={u.address} className="card-modern p-5 hover:border-sky-400/40 transition" whileHover={{ y: -2 }}
                  data-testid={`patient-row-${u.address_lower}`}>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400/20 to-sky-500/30 border border-sky-400/30 flex items-center justify-center shrink-0">
                      <UserCircle size={22} weight="duotone" className="text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-base leading-tight truncate">{u.name}</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono uppercase tracking-wider">patient</div>
                    </div>
                    <StatusBadge status="patient" />
                  </div>
                  <div className="space-y-2">
                    <Hash value={u.did} label="did" testId={`p-did-${u.address_lower}`} />
                    <Hash value={u.address} label="wallet" testId={`p-addr-${u.address_lower}`} />
                  </div>
                  <div className="mt-3 text-[10px] text-zinc-600 font-mono">joined · {u.created_at?.slice(0, 10)}</div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
