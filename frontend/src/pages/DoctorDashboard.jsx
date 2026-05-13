import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import { aesEncryptFile, generateAesKey, exportKeyB64, buildPolicy, shortAddr } from "@/lib/crypto";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { MagnifyingGlass, UploadSimple, FileLock, ShieldStar, CloudArrowUp, TreeStructure, Anchor, Inbox, X } from "@phosphor-icons/react";

const STAGE_ICONS = {
  encrypting: FileLock, uploading: CloudArrowUp, policy: ShieldStar, enqueue: TreeStructure, done: Anchor,
};

export default function DoctorDashboard() {
  const { session, buildSig } = useWallet();
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [linkedRequest, setLinkedRequest] = useState(null); // upload request being fulfilled
  const [accessGrants, setAccessGrants] = useState([]);
  const [records, setRecords] = useState({ uploaded: [], accessible: [], grants: [] });
  const [uploadReqs, setUploadReqs] = useState([]);
  const [file, setFile] = useState(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [pipeline, setPipeline] = useState([]);

  const load = async () => {
    const [u, r, ur] = await Promise.all([
      api.get("/users"),
      api.get(`/records/doctor/${session.address}`),
      api.get(`/upload-requests/doctor/${session.address}`),
    ]);
    setUsers(u.data.filter((x) => x.role === "patient"));
    setRecords(r.data);
    setAccessGrants(r.data.grants || []);
    setUploadReqs(ur.data);
  };
  useEffect(() => { load(); }, []);

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.address.toLowerCase().includes(q) || (u.did || "").toLowerCase().includes(q);
  });

  const sendRequest = async (patient) => {
    try {
      await api.post("/access/request", {
        doctor_address: session.address,
        patient_address: patient.address,
        reason: `Dr. ${session.profile?.name || "Provider"} requesting medical history`,
      });
      toast.success("Request sent", { description: patient.name });
      load();
    } catch (e) {
      toast.error("Request failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const fulfillFromInbox = (req) => {
    const p = users.find((u) => u.address.toLowerCase() === req.patient_address_lower);
    if (!p) return toast.error("Patient not found");
    setSelected(p);
    setLinkedRequest(req);
    setDiagnosis(req.title || "");
    setNotes(req.reason || "");
    setTab("upload");
    toast.info("Linked to upload request", { description: req.title });
  };

  const declineFromInbox = async (req) => {
    try {
      const { message, signature } = await buildSig("decline-upload-request");
      await api.post("/upload-requests/decline", {
        request_id: req.id, doctor_address: session.address, doctor_signature: signature, doctor_message: message,
      });
      toast.success("Request declined");
      load();
    } catch (e) {
      toast.error("Failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const updatePipeline = (stage, status, label) => {
    setPipeline((p) => {
      const idx = p.findIndex((s) => s.stage === stage);
      if (idx === -1) return [...p, { stage, status, label }];
      const cp = [...p]; cp[idx] = { stage, status, label }; return cp;
    });
  };

  const uploadRecord = async () => {
    if (!selected) return toast.error("Select a patient first");
    if (!file) return toast.error("Pick a file");
    if (!diagnosis) return toast.error("Diagnosis required");
    setPipeline([]);
    try {
      updatePipeline("encrypting", "active", "Generating AES-256-GCM key & encrypting payload…");
      const key = await generateAesKey();
      const encrypted = await aesEncryptFile(file, key);
      const keyB64 = await exportKeyB64(key);
      updatePipeline("encrypting", "done", "Payload encrypted (AES-256-GCM)");

      updatePipeline("uploading", "active", "Pinning encrypted blob to IPFS via Pinata…");
      const fd = new FormData(); fd.append("file", encrypted, file.name + ".enc");
      const up = await api.post("/ipfs/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      updatePipeline("uploading", "done", `IPFS CID :: ${up.data.cid.slice(0, 14)}…`);

      updatePipeline("policy", "active", "Wrapping AES key under CP-ABE policy…");
      const policy = buildPolicy({
        patientAddress: selected.address, doctorDepartment: session.profile?.department || "General",
      });
      updatePipeline("policy", "done", policy);

      updatePipeline("enqueue", "active", "Submitting to LPA pending batch…");
      const { message, signature } = await buildSig("upload-record");
      const r = await api.post("/records", {
        uploader_address: session.address, uploader_signature: signature, uploader_message: message,
        patient_address: selected.address, cid: up.data.cid, file_name: file.name, file_size: file.size,
        encrypted_key_b64: keyB64, policy, diagnosis, notes,
        upload_request_id: linkedRequest?.id || null,
      });
      updatePipeline("enqueue", "done", "Queued for next Merkle anchor");
      updatePipeline("done", "done", `Record id :: ${r.data.id.slice(0, 8)}…`);
      toast.success("Record uploaded", { description: r.data.cid });
      setFile(null); setDiagnosis(""); setNotes(""); setLinkedRequest(null); load();
    } catch (e) {
      console.error(e);
      toast.error("Upload failed", { description: e?.response?.data?.detail || e.message });
      updatePipeline("error", "error", e.message);
    }
  };

  const pendingInbox = uploadReqs.filter((u) => u.status === "pending");

  return (
    <Layout
      role="doctor // provider portal"
      title="Provider Console"
      subtitle={`${session.profile?.name || "Provider"} · ${session.profile?.department || "General Medicine"}${session.profile?.hospital ? ` · ${session.profile.hospital}` : ""}`}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-zinc-900/60 border border-white/5 rounded-xl p-1 mb-6 flex-wrap">
          {[
            { v: "search", l: "Patients", i: MagnifyingGlass },
            { v: "inbox", l: `Inbox (${pendingInbox.length})`, i: Inbox },
            { v: "upload", l: "Upload", i: UploadSimple },
            { v: "records", l: "My Records", i: FileLock },
          ].map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}
              className="rounded-lg font-medium text-xs uppercase tracking-wider data-[state=active]:bg-emerald-500 data-[state=active]:text-zinc-950 data-[state=active]:shadow-glow px-5 py-2">
              <t.i size={14} weight="bold" className="mr-2" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="search">
          <div className="card-modern p-4 mb-6 flex items-center gap-3">
            <MagnifyingGlass size={18} weight="bold" className="text-emerald-400 ml-1" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, DID, or wallet 0x…"
              data-testid="patient-search-input"
              className="bg-transparent border-0 font-mono focus-visible:ring-0 placeholder:text-zinc-600" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.length === 0 && <div className="lg:col-span-3 card-modern p-12 text-center text-zinc-500 font-mono text-sm">No registered patients</div>}
            {filtered.map((p) => {
              const grant = accessGrants.find((g) => g.patient_address_lower === p.address.toLowerCase());
              return (
                <motion.div key={p.address} className="card-modern p-5 hover:border-emerald-400/40 transition" whileHover={{ y: -3 }}
                  data-testid={`patient-card-${p.address.toLowerCase()}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-display font-bold text-lg">{p.name}</div>
                      <div className="eyebrow !text-[9px] mt-0.5">patient</div>
                    </div>
                    {grant ? <StatusBadge status="approved" /> : <StatusBadge status="pending" />}
                  </div>
                  <Hash value={p.did} label="did" testId={`p-did-${p.address.toLowerCase()}`} />
                  <div className="mt-2"><Hash value={p.address} label="wallet" testId={`p-addr-${p.address.toLowerCase()}`} /></div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => { setSelected(p); setLinkedRequest(null); setTab("upload"); toast.info("Patient selected", { description: p.name }); }}
                      data-testid={`select-${p.address.toLowerCase()}-btn`}
                      className="flex-1 btn-ghost-modern h-9 px-3 text-[11px] font-semibold">Select</button>
                    {!grant && (
                      <button onClick={() => sendRequest(p)} data-testid={`req-${p.address.toLowerCase()}-btn`}
                        className="flex-1 btn-primary-modern h-9 px-3 text-[11px] font-semibold">Request History</button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="inbox" className="space-y-3">
          {uploadReqs.length === 0 && (
            <div className="card-modern p-16 text-center text-zinc-500 font-mono text-sm">
              <Inbox size={36} weight="duotone" className="mx-auto mb-3 text-zinc-700" />
              No upload requests
            </div>
          )}
          {uploadReqs.map((req) => (
            <div key={req.id} className={`card-modern p-5 ${req.status === "pending" ? "border-amber/30" : ""}`} data-testid={`inbox-${req.id}`}>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="eyebrow text-amber">upload request</div>
                    <StatusBadge status={req.status === "fulfilled" ? "anchored" : req.status} />
                  </div>
                  <div className="font-display font-semibold text-lg mb-1">{req.title}</div>
                  <div className="text-sm text-zinc-300 mb-2">from <span className="font-medium">{req.patient_name}</span></div>
                  <Hash value={req.patient_address} label="patient" testId={`inbox-pat-${req.id}`} />
                  {req.reason && <div className="text-zinc-400 text-xs mt-2 font-mono">message: {req.reason}</div>}
                  <div className="text-[10px] text-zinc-500 mt-2 font-mono">{new Date(req.created_at).toLocaleString()}</div>
                </div>
                {req.status === "pending" && (
                  <div className="flex gap-2 sm:flex-col">
                    <button onClick={() => fulfillFromInbox(req)} data-testid={`fulfill-${req.id}-btn`}
                      className="btn-primary-modern h-10 px-5 text-xs flex items-center gap-2">
                      <UploadSimple size={14} weight="bold" />Fulfill
                    </button>
                    <button onClick={() => declineFromInbox(req)} data-testid={`decline-${req.id}-btn`}
                      className="h-10 px-5 rounded-lg border border-rose/30 bg-rose/5 text-rose font-semibold text-xs hover:bg-rose/10 flex items-center gap-2">
                      <X size={14} weight="bold" />Decline
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="upload">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="card-modern p-6 lg:col-span-2">
              <div className="eyebrow mb-1">step 01 // input</div>
              <h3 className="heading-display text-xl font-bold mb-4">New Medical Record</h3>

              {linkedRequest && (
                <div className="mb-4 p-3 rounded-lg border border-amber/30 bg-amber/5">
                  <div className="flex justify-between items-center">
                    <div className="eyebrow text-amber">fulfilling request</div>
                    <button onClick={() => { setLinkedRequest(null); }} className="text-zinc-500 hover:text-rose text-xs"><X size={14} weight="bold" /></button>
                  </div>
                  <div className="text-sm font-medium mt-1">{linkedRequest.title}</div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <Label className="eyebrow">selected patient</Label>
                  <div className="mt-1.5 rounded-lg border border-white/5 bg-zinc-900/40 p-3 min-h-[50px]" data-testid="selected-patient-box">
                    {selected ? (
                      <div>
                        <div className="font-medium text-sm">{selected.name}</div>
                        <div className="text-[10px] text-emerald-400 font-mono">{selected.did}</div>
                      </div>
                    ) : (<div className="text-zinc-500 font-mono text-xs">choose a patient from the patients tab</div>)}
                  </div>
                </div>

                <div>
                  <Label className="eyebrow">diagnosis / title</Label>
                  <Input data-testid="diagnosis-input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="e.g. Annual checkup abstract"
                    className="rounded-lg bg-zinc-900/60 border-white/5 mt-1.5" />
                </div>

                <div>
                  <Label className="eyebrow">clinical notes</Label>
                  <Textarea data-testid="notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                    className="rounded-lg bg-zinc-900/60 border-white/5 mt-1.5" />
                </div>

                <div>
                  <Label className="eyebrow">file (pdf / abstract)</Label>
                  <Input data-testid="file-input" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="rounded-lg bg-zinc-900/60 border-white/5 mt-1.5 file:bg-emerald-500/20 file:text-emerald-300 file:border-0 file:px-3 file:py-1 file:mr-3 file:rounded-md file:font-mono file:text-[10px] file:uppercase" />
                  {file && <div className="text-[10px] text-zinc-500 font-mono mt-1">{file.name} · {(file.size / 1024).toFixed(1)} KB</div>}
                </div>

                <button data-testid="submit-record-btn" onClick={uploadRecord} disabled={!selected || !file || !diagnosis}
                  className="btn-primary-modern w-full h-12 flex items-center justify-center gap-2 text-sm font-semibold">
                  <UploadSimple size={16} weight="bold" />Encrypt & Submit
                </button>
              </div>
            </div>

            <div className="card-modern p-6 lg:col-span-3">
              <div className="eyebrow mb-1">step 02 // pipeline</div>
              <h3 className="heading-display text-xl font-bold mb-4">Cryptographic Pipeline</h3>
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
                      : s.status === "done" ? "border-emerald-400/30 bg-emerald-500/5"
                      : s.status === "error" ? "border-rose/40 bg-rose/5" : "border-white/5";
                    const iconColor = s.status === "active" ? "text-amber animate-pulse"
                      : s.status === "done" ? "text-emerald-400"
                      : s.status === "error" ? "text-rose" : "text-zinc-500";
                    return (
                      <motion.div key={s.stage} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className={`rounded-lg border p-3 flex items-start gap-3 ${tone}`} data-testid={`pipeline-${s.stage}`}>
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

        <TabsContent value="records" className="space-y-8">
          <div>
            <div className="eyebrow mb-3">uploaded by you</div>
            <div className="card-modern overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="eyebrow">Date</TableHead>
                    <TableHead className="eyebrow">Patient</TableHead>
                    <TableHead className="eyebrow">Diagnosis</TableHead>
                    <TableHead className="eyebrow">CID</TableHead>
                    <TableHead className="eyebrow">Anchor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.uploaded.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-zinc-500 font-mono py-12">No uploads yet</TableCell></TableRow>}
                  {records.uploaded.map((r) => (
                    <TableRow key={r.id} className="border-white/5 hover:bg-white/[0.02]" data-testid={`my-rec-${r.id}`}>
                      <TableCell className="font-mono text-xs text-zinc-400">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell>{r.patient_name} <span className="text-zinc-500 ml-1 text-[10px] font-mono">{shortAddr(r.patient_address)}</span></TableCell>
                      <TableCell className="font-medium">{r.diagnosis}</TableCell>
                      <TableCell><Hash value={r.cid} testId={`d-cid-${r.id}`} /></TableCell>
                      <TableCell>
                        <StatusBadge status={r.anchor_status} />
                        {r.merkle_root && <div className="mt-1.5"><Hash value={r.merkle_root} testId={`d-root-${r.id}`} /></div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-3">granted access ({records.accessible.length})</div>
            <div className="card-modern overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="eyebrow">Patient</TableHead>
                    <TableHead className="eyebrow">Uploaded By</TableHead>
                    <TableHead className="eyebrow">Diagnosis</TableHead>
                    <TableHead className="eyebrow">CID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.accessible.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-zinc-500 font-mono py-12">No granted records</TableCell></TableRow>}
                  {records.accessible.map((r) => (
                    <TableRow key={r.id} className="border-white/5">
                      <TableCell>{r.patient_name}</TableCell>
                      <TableCell>{r.uploader_name}</TableCell>
                      <TableCell className="font-medium">{r.diagnosis}</TableCell>
                      <TableCell><Hash value={r.cid} testId={`g-cid-${r.id}`} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
