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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import MerkleVisualizer from "@/components/MerkleVisualizer";
import LpaCostChart from "@/components/LpaCostChart";
import { merklePreview, aesEncryptFile, generateAesKey, exportKeyB64, buildPolicy, shortAddr } from "@/lib/crypto";
import { copyToClipboard } from "@/lib/clipboard";
import { ethers } from "ethers";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Cube, ArrowsClockwise, Anchor, Users, TreeStructure, Stack, Stethoscope, UserCircle, UserPlus, UploadSimple, FileLock, ShieldStar, CloudArrowUp, Sparkle, Copy, Lightning, Trash, ClipboardText } from "@phosphor-icons/react";

const STAGE_ICONS = { encrypting: FileLock, uploading: CloudArrowUp, policy: ShieldStar, enqueue: TreeStructure, done: Anchor };

export default function AdminDashboard() {
  const { session, buildSig } = useWallet();
  const [users, setUsers] = useState([]);
  const [pending, setPending] = useState([]);
  const [anchors, setAnchors] = useState([]);
  const [stats, setStats] = useState({});
  const [adminRecords, setAdminRecords] = useState([]);
  const [deletingRec, setDeletingRec] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);  // record pending deletion confirmation

  // Audit log state
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditEvent, setAuditEvent] = useState("all");
  const [auditAddr, setAuditAddr] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [preview, setPreview] = useState({ root: "", layers: [] });
  const [anchoring, setAnchoring] = useState(false);
  const [polygonAnchoring, setPolygonAnchoring] = useState(false);
  const [polygonStatus, setPolygonStatus] = useState(null);
  const [receipt, setReceipt] = useState(null);   // popup after any anchor / sim

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
    const [u, p, a, s, ar] = await Promise.all([
      api.get("/users"), api.get("/lpa/pending"), api.get("/lpa/anchors"), api.get("/lpa/stats"),
      api.get("/admin/records"),
    ]);
    setUsers(u.data); setPending(p.data); setAnchors(a.data); setStats(s.data);
    setAdminRecords(ar.data);
    setPreview(p.data.length ? merklePreview(p.data.map((x) => x.cid)) : { root: "", layers: [] });
  };

  const loadAuditLog = async () => {
    setAuditLoading(true);
    try {
      const { message, signature } = await buildSig("view-audit-log");
      const params = new URLSearchParams();
      if (auditEvent && auditEvent !== "all") params.set("event", auditEvent);
      if (auditAddr.trim()) params.set("address", auditAddr.trim());
      params.set("limit", "300");
      const [r, s] = await Promise.all([
        api.post(`/admin/audit-log?${params.toString()}`, {
          admin_address: session.address, signature, message,
        }),
        api.get("/admin/audit-log/summary"),
      ]);
      setAuditEvents(r.data.events || []);
      setAuditSummary(s.data);
    } catch (e) {
      toast.error("Audit fetch failed", { description: e?.response?.data?.detail || e.message });
    } finally {
      setAuditLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Load Polygon status once
  useEffect(() => {
    api.get("/polygon/status").then((r) => setPolygonStatus(r.data)).catch(() => {});
  }, []);

  const doctors = users.filter((u) => u.role === "doctor");
  const patients = users.filter((u) => u.role === "patient");

  const anchor = async () => {
    setAnchoring(true);
    try {
      const { message, signature } = await buildSig("anchor-merkle-root");
      const r = await api.post("/lpa/anchor", { admin_address: session.address, signature, message });
      toast.success("Merkle root anchored to permissioned ledger", { description: r.data.root.slice(0, 22) + "…" });
      setReceipt({ kind: "permissioned", ...r.data });
      load();
    } catch (e) {
      toast.error("Anchor failed", { description: e?.response?.data?.detail || e.message });
    } finally { setAnchoring(false); }
  };

  const anchorPolygon = async () => {
    setPolygonAnchoring(true);
    try {
      // Refresh status first to give an early error if wallet still empty
      const stat = await api.get("/polygon/status");
      setPolygonStatus(stat.data);
      if (!stat.data.funded) {
        toast.error("Admin wallet has 0 POL on Polygon Amoy", {
          description: "Request testnet POL from the faucet, then try again.",
        });
        return;
      }
      const { message, signature } = await buildSig("anchor-merkle-root-polygon");
      const r = await api.post("/lpa/anchor-polygon", { admin_address: session.address, signature, message });
      toast.success("Anchored on Polygon Amoy 🟣", { description: r.data.tx_hash.slice(0, 22) + "…" });
      setReceipt({ kind: "polygon", ...r.data });
      load();
    } catch (e) {
      const det = e?.response?.data?.detail;
      const msg = typeof det === "string" ? det : (det?.message || e.message);
      toast.error("Polygon anchor failed", { description: msg });
    } finally { setPolygonAnchoring(false); }
  };

  const [simulating, setSimulating] = useState(false);
  const simulate = async (count = 10) => {
    setSimulating(true);
    try {
      const { message, signature } = await buildSig("simulate-lpa-batch");
      const r = await api.post("/lpa/simulate", { admin_address: session.address, signature, message, count });
      toast.success(`+${r.data.inserted} synthetic records queued`, { description: "Watch the cost chart update" });
      setReceipt({ kind: "simulate", count: r.data.inserted, total: r.data.total_pending });
      load();
    } catch (e) {
      toast.error("Simulate failed", { description: e?.response?.data?.detail || e.message });
    } finally { setSimulating(false); }
  };

  const [demoScenario, setDemoScenario] = useState(null);   // shown in a modal after seeding
  const [seedingDemo, setSeedingDemo] = useState(false);

  const seedDemoScenario = async () => {
    setSeedingDemo(true);
    try {
      const { message, signature } = await buildSig("seed-demo-scenario");
      const r = await api.post("/admin/seed-demo-scenario", { admin_address: session.address, signature, message, count: 0 });
      setDemoScenario(r.data);
      toast.success("Demo patient + doctor + record seeded", { description: "Copy the wallet keys to run the survey flow" });
      load();
    } catch (e) {
      toast.error("Demo seed failed", { description: e?.response?.data?.detail || e.message });
    } finally { setSeedingDemo(false); }
  };

  const clearDemoScenario = async () => {
    try {
      const { message, signature } = await buildSig("clear-demo-scenario");
      const r = await api.post("/admin/clear-demo-scenario", { admin_address: session.address, signature, message, count: 0 });
      toast.success(`Cleared demo · removed ${r.data.removed_users} users / ${r.data.removed_records} records`);
      load();
    } catch (e) {
      toast.error("Clear demo failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const clearSim = async () => {
    try {
      const { message, signature } = await buildSig("clear-sim-records");
      const r = await api.post("/lpa/clear-simulated", { admin_address: session.address, signature, message, count: 0 });
      toast.success(`Cleared ${r.data.removed_pending} synthetic records`);
      load();
    } catch (e) {
      toast.error("Clear failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const deleteRecord = async (rec) => {
    setDeletingRec(rec.id);
    try {
      const { message, signature } = await buildSig(`delete-record-${rec.id}`);
      const r = await api.delete(`/admin/records/${rec.id}`, {
        data: { admin_address: session.address, signature, message },
      });
      const pinMsg = r.data.pinata?.unpinned ? "unpinned from Pinata" : `Pinata: ${r.data.pinata?.reason || "not unpinned"}`;
      toast.success("Record deleted", { description: pinMsg });
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error("Delete failed", { description: e?.response?.data?.detail || e.message });
    } finally {
      setDeletingRec(null);
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

      upPipeline("policy", "active", "Wrapping AES key under PBAE policy…");
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

  const copyText = async (t) => {
    const ok = await copyToClipboard(t);
    if (ok) toast.success("Copied");
    else toast.error("Copy blocked — select & copy manually");
  };

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
            { v: "records", l: `Records (${adminRecords.length})`, i: FileLock },
            { v: "audit", l: "Audit Log", i: ClipboardText },
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
                {anchoring ? "Anchoring…" : `Anchor Merkle Root (${pending.length}) · Permissioned Ledger`}
              </button>

              {/* Polygon Live Anchor — REAL on-chain transaction */}
              <button onClick={anchorPolygon}
                disabled={pending.length === 0 || polygonAnchoring}
                data-testid="anchor-polygon-btn"
                className="w-full h-12 mt-3 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all
                           bg-gradient-to-r from-purple-600 via-violet-500 to-fuchsia-600
                           hover:from-purple-500 hover:via-violet-400 hover:to-fuchsia-500
                           text-white border border-violet-400/60 shadow-[0_0_20px_rgba(139,92,246,0.35)]
                           disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none">
                <svg width="18" height="18" viewBox="0 0 38 33" fill="currentColor"><path d="M29 10.2c-.7-.4-1.6-.4-2.4 0L21 13.5l-3.8 2.1-5.5 3.3c-.7.4-1.6.4-2.4 0L5 16.2c-.7-.4-1.2-1.2-1.2-2.1v-5c0-.8.4-1.6 1.2-2.1L9.3 4.4c.7-.4 1.6-.4 2.4 0L16 7c.7.4 1.2 1.2 1.2 2.1v3.3l3.8-2.2V6.9c0-.8-.4-1.6-1.2-2.1L12 0c-.7-.4-1.6-.4-2.4 0L1.2 4.8C.4 5.2 0 6 0 6.9v9.6c0 .8.4 1.6 1.2 2.1l8.5 4.8c.7.4 1.6.4 2.4 0l5.5-3.2 3.8-2.2 5.5-3.2c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v5c0 .8-.4 1.6-1.2 2.1L29 28.9c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1V21l-3.8 2.2v3.3c0 .8.4 1.6 1.2 2.1l8.5 4.8c.7.4 1.6.4 2.4 0l8.5-4.8c.7-.4 1.2-1.2 1.2-2.1v-9.6c0-.8-.4-1.6-1.2-2.1L29 10.2z"/></svg>
                {polygonAnchoring ? "Submitting to Polygon…" : "Anchor on Polygon (Live)"}
                <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider bg-white/20 text-white/90">live</span>
              </button>
              <div className="mt-2 text-center text-[10px] font-mono text-violet-300/70 leading-tight">
                Live on-chain · Polygon Amoy testnet ·{" "}
                {polygonStatus?.funded
                  ? <span className="text-emerald-300">wallet funded ({polygonStatus.balance_pol.toFixed(3)} POL)</span>
                  : <span className="text-amber-300">wallet needs faucet POL — see status panel</span>}
              </div>

              {/* LPA Batch Populator */}
              <div className="mt-4 rounded-lg border border-cyan-300/30 bg-cyan-300/5 p-4" data-testid="lpa-simulator">
                <div className="flex items-center gap-2 mb-2">
                  <Lightning size={16} weight="duotone" className="text-cyan-300" />
                  <div className="eyebrow text-cyan-300">batch populator</div>
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
                  <Trash size={11} weight="bold" />clear synthetic
                </button>
              </div>

              {/* DEMO SCENARIO — seed 1 patient + 1 doctor + 1 medical record */}
              <div className="rounded-xl border border-emerald-400/40 bg-gradient-to-br from-emerald-950/60 via-zinc-950 to-zinc-950 p-4">
                <div className="eyebrow mb-1 text-emerald-300">demo scenario</div>
                <div className="text-xs text-zinc-400 mb-3 leading-snug">
                  One-click seed: a patient with cardiology history, a doctor, and an encrypted record. Use the keys to run a full request-and-approve survey demo.
                </div>
                <button onClick={seedDemoScenario} disabled={seedingDemo}
                  data-testid="seed-demo-scenario-btn"
                  className="w-full h-10 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-semibold text-xs uppercase tracking-wider transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_0_18px_rgba(16,185,129,0.35)]">
                  <Sparkle size={13} weight="bold" />
                  {seedingDemo ? "seeding…" : "seed demo patient + record"}
                </button>
                <button onClick={clearDemoScenario}
                  data-testid="clear-demo-scenario-btn"
                  className="mt-2 w-full h-8 rounded-lg border border-rose/30 bg-rose/5 text-rose/90 font-mono uppercase text-[10px] hover:bg-rose/10 transition flex items-center justify-center gap-2">
                  <Trash size={11} weight="bold" />clear demo scenario
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

        {/* Records — admin view with unpin/delete */}
        <TabsContent value="records">
          <div className="card-modern p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="eyebrow mb-1">all medical records</div>
                <h3 className="heading-display text-xl font-bold">Stored Records ({adminRecords.length})</h3>
                <p className="text-zinc-400 text-sm mt-2 max-w-2xl">
                  Every encrypted record currently pinned to Pinata IPFS. Use <span className="text-rose font-medium">Unpin & Delete</span>
                  &nbsp;to remove a record permanently — the CID is unpinned from Pinata, the row is removed from MongoDB, and any
                  pending LPA queue entry is dropped. Anchored Merkle roots remain valid on-chain (they prove what <em>was</em> stored).
                </p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/5">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="eyebrow">file</TableHead>
                    <TableHead className="eyebrow">patient</TableHead>
                    <TableHead className="eyebrow">uploader</TableHead>
                    <TableHead className="eyebrow">cid</TableHead>
                    <TableHead className="eyebrow">anchor</TableHead>
                    <TableHead className="eyebrow text-right">action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminRecords.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-zinc-500 font-mono py-12">No records yet</TableCell></TableRow>
                  )}
                  {adminRecords.map((r) => (
                    <TableRow key={r.id} className="border-white/5" data-testid={`admin-rec-${r.id}`}>
                      <TableCell className="py-3">
                        <div className="font-medium text-sm">{r.file_name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{r.diagnosis || "—"} · {(r.file_size / 1024).toFixed(1)} KB</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.patient_name}</div>
                        <Hash value={r.patient_address} testId={`admin-rec-pat-${r.id}`} />
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-zinc-400">{r.uploader_name}</div>
                        <div className="text-[10px] text-zinc-600 font-mono">{r.uploader_role}</div>
                      </TableCell>
                      <TableCell><Hash value={r.cid} testId={`admin-rec-cid-${r.id}`} /></TableCell>
                      <TableCell><StatusBadge status={r.anchor_status || "pending"} /></TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => setConfirmDelete(r)}
                          disabled={deletingRec === r.id}
                          data-testid={`admin-delete-rec-${r.id}`}
                          className="h-9 px-3 rounded-lg border border-rose/40 bg-rose/5 text-rose font-semibold text-xs hover:bg-rose/15 disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <Trash size={12} weight="bold" />
                          {deletingRec === r.id ? "Unpinning…" : "Unpin & Delete"}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* Audit Log — RA 10173 §16 & §20 compliance trail */}
        <TabsContent value="audit">
          <div className="card-modern p-6">
            <div className="flex items-start justify-between gap-6 mb-5 flex-wrap">
              <div className="flex-1 min-w-[280px]">
                <div className="eyebrow mb-1">ra 10173 § 16 / § 20 · tamper-evident trail</div>
                <h3 className="heading-display text-xl font-bold">Audit Log</h3>
                <p className="text-zinc-400 text-sm mt-2 max-w-2xl">
                  Every privacy-relevant action — access requests, approvals, denials, revocations, record uploads,
                  decryptions, deletions, and Merkle anchors — is appended here with a <span className="text-sky-400 font-mono">SHA-256</span>
                  &nbsp;hash of the wallet signature, so consent decisions are verifiable without storing the raw signature blob.
                </p>
              </div>
              {auditSummary && (
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-white/5">
                    <div className="eyebrow !text-[9px]">total events</div>
                    <div className="text-sky-400 text-lg font-bold mt-0.5">{auditSummary.total}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-white/5">
                    <div className="eyebrow !text-[9px]">event types</div>
                    <div className="text-sky-400 text-lg font-bold mt-0.5">{auditSummary.by_event?.length || 0}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3 items-end mb-5 p-4 rounded-lg bg-zinc-900/40 border border-white/5">
              <div className="flex-1 min-w-[180px]">
                <Label className="eyebrow">event type</Label>
                <Select value={auditEvent} onValueChange={setAuditEvent}>
                  <SelectTrigger data-testid="audit-event-select" className="mt-1.5 rounded-lg bg-zinc-950 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg bg-zinc-900 border-white/10">
                    <SelectItem value="all">All events</SelectItem>
                    <SelectItem value="access.request">access.request</SelectItem>
                    <SelectItem value="access.approve">access.approve</SelectItem>
                    <SelectItem value="access.deny">access.deny</SelectItem>
                    <SelectItem value="access.revoke">access.revoke (§16)</SelectItem>
                    <SelectItem value="record.upload">record.upload</SelectItem>
                    <SelectItem value="record.decrypt">record.decrypt</SelectItem>
                    <SelectItem value="record.decrypt.denied">record.decrypt.denied</SelectItem>
                    <SelectItem value="record.delete">record.delete (§16)</SelectItem>
                    <SelectItem value="anchor.create">anchor.create</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[260px]">
                <Label className="eyebrow">address (actor / target / subject)</Label>
                <Input
                  value={auditAddr}
                  onChange={(e) => setAuditAddr(e.target.value)}
                  placeholder="0x… leave blank for all"
                  data-testid="audit-address-input"
                  className="mt-1.5 rounded-lg bg-zinc-950 border-white/10 font-mono text-xs"
                />
              </div>
              <button
                onClick={loadAuditLog}
                disabled={auditLoading}
                data-testid="audit-fetch-btn"
                className="btn-primary-modern h-10 px-5 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <ArrowsClockwise size={14} weight="bold" className={auditLoading ? "animate-spin" : ""} />
                {auditLoading ? "Loading…" : "Fetch & Sign"}
              </button>
            </div>

            {auditSummary && auditSummary.by_event?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {auditSummary.by_event.map((b) => (
                  <button
                    key={b.event_type}
                    onClick={() => { setAuditEvent(b.event_type); }}
                    className="px-3 py-1.5 rounded-full bg-zinc-900/60 border border-white/10 text-[10px] font-mono hover:border-sky-400/40 transition"
                    data-testid={`audit-chip-${b.event_type}`}
                  >
                    <span className="text-zinc-400">{b.event_type}</span>
                    <span className="text-sky-400 ml-2 font-bold">{b.count}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-white/5">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="eyebrow">timestamp</TableHead>
                    <TableHead className="eyebrow">event</TableHead>
                    <TableHead className="eyebrow">actor</TableHead>
                    <TableHead className="eyebrow">subject / target</TableHead>
                    <TableHead className="eyebrow">decision</TableHead>
                    <TableHead className="eyebrow">sig hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditEvents.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-zinc-500 font-mono py-12">
                      {auditLoading ? "Loading…" : "Click \"Fetch & Sign\" to load the audit trail"}
                    </TableCell></TableRow>
                  )}
                  {auditEvents.map((ev) => (
                    <TableRow key={ev.id} className="border-white/5" data-testid={`audit-row-${ev.id}`}>
                      <TableCell className="font-mono text-[10px] text-zinc-500 whitespace-nowrap">
                        {new Date(ev.ts).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${
                          ev.event_type.startsWith("access.revoke") || ev.event_type === "record.delete"
                            ? "border-rose/40 bg-rose/5 text-rose"
                            : ev.event_type.endsWith("denied")
                            ? "border-amber/40 bg-amber/5 text-amber"
                            : ev.event_type === "anchor.create"
                            ? "border-emerald/40 bg-emerald/5 text-emerald-400"
                            : "border-sky-400/30 bg-sky-500/5 text-sky-400"
                        }`}>{ev.event_type}</span>
                        {ev.metadata?.ra_10173_clause && (
                          <div className="text-[9px] text-zinc-500 font-mono mt-1">{ev.metadata.ra_10173_clause}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {ev.actor_role && <div className="text-[10px] uppercase font-mono text-zinc-500">{ev.actor_role}</div>}
                        <div className="font-mono text-[11px] text-zinc-300">{shortAddr(ev.actor_address)}</div>
                      </TableCell>
                      <TableCell>
                        {ev.subject_address && <div className="font-mono text-[11px] text-zinc-300">{shortAddr(ev.subject_address)}</div>}
                        {ev.record_id && <div className="text-[9px] text-zinc-600 font-mono">rec · {ev.record_id.slice(0, 8)}…</div>}
                      </TableCell>
                      <TableCell>
                        {ev.decision ? (
                          <span className={`font-mono text-[10px] ${ev.decision === "approved" || ev.decision === "allowed" || ev.decision === "unpinned" ? "text-emerald-400" : ev.decision === "denied" || ev.decision === "revoked" ? "text-rose" : "text-zinc-400"}`}>
                            {ev.decision}
                          </span>
                        ) : <span className="text-zinc-600 text-[10px]">—</span>}
                      </TableCell>
                      <TableCell>
                        {ev.signature_hash ? (
                          <span className="font-mono text-[10px] text-zinc-500" title={ev.signature_hash}>
                            {ev.signature_hash.slice(0, 10)}…{ev.signature_hash.slice(-6)}
                          </span>
                        ) : <span className="text-zinc-600 text-[10px]">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

      {/* DEMO SCENARIO MODAL — shows demo wallets + instructions after seeding */}
      <AnimatePresence>
        {demoScenario && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
            data-testid="demo-scenario-modal">
            <motion.div
              initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }}
              className="w-full max-w-2xl my-8 rounded-2xl border border-emerald-400/50 bg-zinc-950 p-7 shadow-[0_0_60px_rgba(16,185,129,0.3)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="eyebrow text-emerald-300 mb-1">demo scenario · ready</div>
                  <h2 className="text-2xl font-bold text-emerald-100">Patient + Doctor + Record Seeded ✓</h2>
                </div>
                <button onClick={() => setDemoScenario(null)} className="text-zinc-500 hover:text-zinc-200 text-xl">×</button>
              </div>

              <p className="text-xs text-zinc-400 mb-5">
                Copy each wallet's private key and import it on the Login page (Sign in with Private Key) to act as that user during your survey demo.
              </p>

              {/* DOCTOR CARD */}
              <div className="mb-3 rounded-lg border border-sky-400/30 bg-sky-950/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-sky-300">doctor · cardiology</div>
                    <div className="font-bold text-sky-100">{demoScenario.doctor.name}</div>
                    <div className="text-[11px] text-zinc-500">{demoScenario.doctor.hospital}</div>
                  </div>
                  <button onClick={async () => {
                      const ok = await copyToClipboard(demoScenario.doctor.private_key);
                      if (ok) toast.success("Doctor private key copied");
                      else toast.error("Copy blocked — long-press the key to select");
                    }}
                    data-testid="copy-doctor-pk-btn"
                    className="px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-400/40 transition">
                    Copy PK
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mb-1">address</div>
                <div className="font-mono text-[11px] text-zinc-300 break-all mb-2">{demoScenario.doctor.address}</div>
                <div className="text-[10px] text-zinc-500 font-mono mb-1">private key</div>
                <div className="font-mono text-[11px] text-zinc-300 break-all bg-black/40 p-2 rounded border border-zinc-800">{demoScenario.doctor.private_key}</div>
              </div>

              {/* PATIENT CARD */}
              <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-950/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-amber-300">patient</div>
                    <div className="font-bold text-amber-100">{demoScenario.patient.name}</div>
                    <div className="text-[11px] text-zinc-500">DOB 1987-03-14 · Blood Type O+</div>
                  </div>
                  <button onClick={async () => {
                      const ok = await copyToClipboard(demoScenario.patient.private_key);
                      if (ok) toast.success("Patient private key copied");
                      else toast.error("Copy blocked — long-press the key to select");
                    }}
                    data-testid="copy-patient-pk-btn"
                    className="px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/40 transition">
                    Copy PK
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mb-1">address</div>
                <div className="font-mono text-[11px] text-zinc-300 break-all mb-2">{demoScenario.patient.address}</div>
                <div className="text-[10px] text-zinc-500 font-mono mb-1">private key</div>
                <div className="font-mono text-[11px] text-zinc-300 break-all bg-black/40 p-2 rounded border border-zinc-800">{demoScenario.patient.private_key}</div>
              </div>

              {/* RECORD CARD */}
              <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">encrypted medical record</div>
                <div className="font-bold text-emerald-100">{demoScenario.record.file_name}</div>
                <div className="text-[11px] text-zinc-400 mt-1">{demoScenario.record.diagnosis}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] font-mono">
                  <div>
                    <div className="text-zinc-500">IPFS CID</div>
                    <div className="text-zinc-200 truncate">{demoScenario.record.cid}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">access policy</div>
                    <div className="text-zinc-200 truncate">{demoScenario.record.policy}</div>
                  </div>
                </div>
              </div>

              {/* INSTRUCTIONS */}
              <div className="rounded-lg border border-zinc-700 bg-black/40 p-4 text-[12px] text-zinc-300 leading-relaxed">
                <div className="text-emerald-300 font-bold mb-2 text-[11px] uppercase tracking-wider">defense demo flow</div>
                <ol className="space-y-1 list-decimal pl-4">
                  {demoScenario.instructions.map((step, i) => (<li key={i}>{step}</li>))}
                </ol>
              </div>

              <button onClick={() => setDemoScenario(null)}
                className="mt-5 w-full h-10 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 text-xs uppercase tracking-wider font-semibold transition">
                got it — let's demo
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RECEIPT MODAL — pops after sim / simulated anchor / polygon anchor */}
      <AnimatePresence>
        {receipt && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setReceipt(null)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm p-4"
            data-testid="anchor-receipt">
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }}
              className={
                "w-full max-w-md rounded-2xl border p-6 font-mono " +
                (receipt.kind === "polygon"
                  ? "bg-gradient-to-br from-violet-950 via-zinc-950 to-fuchsia-950 border-violet-400/50 shadow-[0_0_50px_rgba(139,92,246,0.4)]"
                  : "bg-zinc-950 border-sky-400/40 shadow-[0_0_40px_rgba(56,189,248,0.25)]")
              }>
              <div className="flex items-center justify-between mb-4">
                <div className={"text-[11px] uppercase tracking-[0.3em] " + (receipt.kind === "polygon" ? "text-fuchsia-300" : "text-sky-300")}>
                  {receipt.kind === "polygon" ? "POLYGON RECEIPT" : receipt.kind === "simulate" ? "BATCH POPULATED" : "ANCHOR RECEIPT"}
                </div>
                <button onClick={() => setReceipt(null)} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
              </div>

              {/* PERFORATED HEADER */}
              <div className={"text-2xl font-bold mb-1 " + (receipt.kind === "polygon" ? "text-violet-100" : "text-sky-100")}>
                {receipt.kind === "polygon" ? "✓ Anchored on Polygon" : receipt.kind === "simulate" ? "✓ Batch Populated" : "✓ Merkle Anchor Created"}
              </div>
              <div className="text-xs text-zinc-400 mb-5">
                {receipt.kind === "polygon"
                  ? "Live on Polygon Amoy testnet · publicly verifiable"
                  : receipt.kind === "simulate"
                  ? "Synthetic records added to pending batch · zero cost"
                  : "Merkle root persisted in private permissioned ledger"}
              </div>

              <div className="border-t border-dashed border-zinc-700 my-4"></div>

              {/* CONTENT BY KIND */}
              {receipt.kind === "simulate" ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-zinc-500">Records added</span><span className="text-emerald-300 font-bold">+{receipt.count}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Pending in batch</span><span className="text-zinc-100">{receipt.total}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Transaction cost</span><span className="text-emerald-300 font-bold">FREE (synthetic batch)</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Cost / record after batching</span><span className="text-emerald-300">↓ asymptotic</span></div>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500 shrink-0">Merkle root</span>
                    <span className="text-zinc-100 truncate text-[11px]">{receipt.root}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500 shrink-0">Tx hash</span>
                    <span className="text-zinc-100 truncate text-[11px]">{receipt.tx_hash}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-zinc-500">Block</span><span className="text-zinc-100">#{receipt.block_number}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Leaves anchored</span><span className="text-zinc-100">{receipt.leaf_count}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Network</span>
                    <span className={receipt.kind === "polygon" ? "text-fuchsia-300 font-bold" : "text-sky-300"}>
                      {receipt.kind === "polygon" ? "Polygon Amoy" : "Private permissioned"}
                    </span>
                  </div>

                  {/* LPA aggregation cost breakdown — the whole point of LPA */}
                  {receipt.leaf_count > 0 && (() => {
                    const GAS_PER_TX = 80000;
                    const GWEI = 20;
                    const ETH_PHP = 215000;
                    const txCostPhp = (GAS_PER_TX * GWEI / 1e9) * ETH_PHP;
                    const naiveTotal = txCostPhp * receipt.leaf_count;
                    const lpaTotal = txCostPhp;
                    const naivePerRec = txCostPhp;
                    const lpaPerRec = txCostPhp / receipt.leaf_count;
                    const savedTotal = naiveTotal - lpaTotal;
                    const savingsPct = receipt.leaf_count > 1 ? (1 - 1 / receipt.leaf_count) * 100 : 0;
                    const fmt = (n) => "₱" + n.toFixed(2);
                    return (
                      <div className="mt-4 rounded-lg border border-emerald-400/40 bg-gradient-to-br from-emerald-950/50 to-zinc-950 p-3" data-testid="receipt-lpa-cost">
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="text-[10px] uppercase tracking-widest text-emerald-300">LPA aggregation · cost amortization</div>
                          <div className="text-[10px] font-mono text-emerald-200/60">80k gas · 20 gwei</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded bg-rose-950/30 border border-rose-400/20 p-2">
                            <div className="text-[9px] uppercase tracking-wider text-rose-300/80">naive · 1 tx / record</div>
                            <div className="text-rose-200 font-bold text-sm mt-0.5">{fmt(naiveTotal)}</div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">{fmt(naivePerRec)} × {receipt.leaf_count}</div>
                          </div>
                          <div className="rounded bg-emerald-950/40 border border-emerald-400/30 p-2">
                            <div className="text-[9px] uppercase tracking-wider text-emerald-300/80">with LPA · 1 tx total</div>
                            <div className="text-emerald-200 font-bold text-sm mt-0.5">{fmt(lpaTotal)}</div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">{fmt(lpaPerRec)} per record</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2.5 px-1">
                          <span className="text-[10px] text-zinc-400">Net saved</span>
                          <span className="text-emerald-300 font-bold text-sm" data-testid="receipt-saved">
                            {fmt(savedTotal)} <span className="text-[10px] text-emerald-400/70">({savingsPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {receipt.explorer_url && (
                    <a href={receipt.explorer_url} target="_blank" rel="noreferrer"
                       data-testid="receipt-explorer-link"
                       className="block mt-4 text-center py-3 rounded-lg bg-violet-600/30 hover:bg-violet-600/50 border border-violet-400/40 text-violet-100 text-[11px] uppercase tracking-wider transition">
                      view on PolygonScan ↗
                    </a>
                  )}
                </div>
              )}

              <div className="border-t border-dashed border-zinc-700 my-5"></div>
              <div className="text-[10px] text-zinc-600 text-center uppercase tracking-widest">Gen C · privacy by design · RA 10173 §20</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* UNPIN & DELETE CONFIRMATION (native window.confirm is blocked inside Emergent's iframe) */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md rounded-2xl bg-zinc-950 border-rose/30" data-testid="confirm-delete-modal">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Unpin &amp; delete record?</DialogTitle>
          </DialogHeader>
          {confirmDelete && (
            <div className="space-y-4">
              <div className="rounded-lg border border-rose/30 bg-rose/5 p-4">
                <div className="eyebrow !text-rose mb-2">about to delete</div>
                <div className="font-medium text-sm">{confirmDelete.file_name}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{confirmDelete.diagnosis || "—"} · {(confirmDelete.file_size / 1024).toFixed(1)} KB</div>
                <div className="mt-3">
                  <div className="eyebrow !text-[9px]">patient</div>
                  <div className="text-xs text-zinc-300 mt-0.5">{confirmDelete.patient_name}</div>
                </div>
                <div className="mt-2">
                  <div className="eyebrow !text-[9px]">cid</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5 break-all">{confirmDelete.cid}</div>
                </div>
              </div>
              <ul className="text-xs text-zinc-400 space-y-2 list-disc pl-5">
                <li>The CID will be <span className="text-rose font-medium">unpinned from Pinata IPFS</span>.</li>
                <li>The record row will be removed from MongoDB.</li>
                <li>If pending, it will be dropped from the LPA queue.</li>
                <li><span className="text-amber font-medium">Anchored Merkle roots remain valid</span> — they prove what <em>was</em> stored, but the CID will no longer resolve.</li>
                <li>This cannot be undone.</li>
              </ul>
            </div>
          )}
          <DialogFooter className="gap-2 mt-2">
            <button
              onClick={() => setConfirmDelete(null)}
              disabled={!!deletingRec}
              data-testid="cancel-delete-btn"
              className="btn-ghost-modern h-10 px-5 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmDelete && deleteRecord(confirmDelete)}
              disabled={!!deletingRec}
              data-testid="confirm-delete-btn"
              className="h-10 px-5 rounded-lg border border-rose/40 bg-rose/10 text-rose font-semibold text-xs hover:bg-rose/20 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Trash size={14} weight="bold" />
              {deletingRec ? "Unpinning…" : "Unpin & Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
