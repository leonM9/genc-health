import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import {
  aesEncryptFile,
  generateAesKey,
  exportKeyB64,
  buildPolicy,
  shortAddr,
} from "@/lib/crypto";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { MagnifyingGlass, UploadSimple, FileLock, ShieldStar, CloudArrowUp, TreeStructure, Anchor } from "@phosphor-icons/react";

const STAGE_ICONS = {
  encrypting: FileLock,
  uploading: CloudArrowUp,
  policy: ShieldStar,
  enqueue: TreeStructure,
  done: Anchor,
};

export default function DoctorDashboard() {
  const { session, buildSig } = useWallet();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [accessGrants, setAccessGrants] = useState([]);
  const [records, setRecords] = useState({ uploaded: [], accessible: [], grants: [] });
  const [file, setFile] = useState(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [pipeline, setPipeline] = useState([]); // [{stage, label, status}]
  const [reqReason, setReqReason] = useState("");

  const load = async () => {
    const [u, r] = await Promise.all([
      api.get("/users"),
      api.get(`/records/doctor/${session.address}`),
    ]);
    setUsers(u.data.filter((x) => x.role === "patient"));
    setRecords(r.data);
    setAccessGrants(r.data.grants || []);
  };
  useEffect(() => { load(); }, []);

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.address.toLowerCase().includes(q) ||
      (u.did || "").toLowerCase().includes(q)
    );
  });

  const sendRequest = async (patient) => {
    try {
      await api.post("/access/request", {
        doctor_address: session.address,
        patient_address: patient.address,
        reason: reqReason || `Dr. ${session.profile?.name || ""} requesting medical history`,
      });
      toast.success("Request sent", { description: `${patient.name} will be notified` });
      load();
    } catch (e) {
      toast.error("Request failed", { description: e.response?.data?.detail || e.message });
    }
  };

  const updatePipeline = (stage, status, label) => {
    setPipeline((p) => {
      const idx = p.findIndex((s) => s.stage === stage);
      if (idx === -1) return [...p, { stage, status, label }];
      const cp = [...p];
      cp[idx] = { stage, status, label };
      return cp;
    });
  };

  const uploadRecord = async () => {
    if (!selected) return toast.error("Select a patient first");
    if (!file) return toast.error("Pick a file");
    if (!diagnosis) return toast.error("Diagnosis required");
    setPipeline([]);
    try {
      // 1. AES encrypt locally
      updatePipeline("encrypting", "active", "Generating AES-256-GCM key & encrypting payload…");
      const key = await generateAesKey();
      const encrypted = await aesEncryptFile(file, key);
      const keyB64 = await exportKeyB64(key);
      updatePipeline("encrypting", "done", "Payload encrypted (AES-256-GCM)");

      // 2. Upload to Pinata
      updatePipeline("uploading", "active", "Pinning encrypted blob to IPFS via Pinata…");
      const fd = new FormData();
      fd.append("file", encrypted, file.name + ".enc");
      const up = await api.post("/ipfs/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      updatePipeline("uploading", "done", `IPFS CID :: ${up.data.cid.slice(0, 12)}…`);

      // 3. Build CP-ABE policy
      updatePipeline("policy", "active", "Wrapping AES key under CP-ABE policy…");
      const policy = buildPolicy({
        patientAddress: selected.address,
        doctorDepartment: session.profile?.department || "General",
      });
      updatePipeline("policy", "done", policy);

      // 4. Sign and submit metadata
      updatePipeline("enqueue", "active", "Submitting to LPA pending batch…");
      const { message, signature } = await buildSig("upload-record");
      const r = await api.post("/records", {
        uploader_address: session.address,
        uploader_signature: signature,
        uploader_message: message,
        patient_address: selected.address,
        cid: up.data.cid,
        file_name: file.name,
        file_size: file.size,
        encrypted_key_b64: keyB64,
        policy,
        diagnosis,
        notes,
      });
      updatePipeline("enqueue", "done", "Queued for next Merkle anchor");

      updatePipeline("done", "done", `Record id :: ${r.data.id.slice(0, 8)}…`);
      toast.success("Record uploaded", { description: r.data.cid });

      setFile(null);
      setDiagnosis("");
      setNotes("");
      load();
    } catch (e) {
      console.error(e);
      toast.error("Upload failed", { description: e.response?.data?.detail || e.message });
      updatePipeline("error", "error", e.message);
    }
  };

  return (
    <Layout
      role="doctor :: provider portal"
      title="Provider Console"
      subtitle="Search by DID or wallet. Request access. Upload encrypted abstracts. All keys are wrapped under CP-ABE policies."
    >
      <Tabs defaultValue="search">
        <TabsList className="rounded-none bg-transparent border-b border-zinc-800 w-full justify-start h-auto p-0 gap-0">
          {[
            { v: "search", l: "Patient Search", i: MagnifyingGlass },
            { v: "upload", l: "Upload Record", i: UploadSimple },
            { v: "records", l: "My Records", i: FileLock },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              data-testid={`tab-${t.v}`}
              className="rounded-none font-mono uppercase text-xs tracking-widest data-[state=active]:bg-terminal data-[state=active]:text-black data-[state=active]:shadow-none px-6 py-3"
            >
              <t.i size={14} weight="bold" className="mr-2" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Search */}
        <TabsContent value="search" className="pt-8">
          <div className="border border-zinc-800 bg-[#0c0c0e] p-4 mb-6">
            <div className="flex gap-3 items-center">
              <MagnifyingGlass size={18} weight="bold" className="text-terminal" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, DID, or wallet 0x..."
                data-testid="patient-search-input"
                className="rounded-none bg-transparent border-0 font-mono focus-visible:ring-0 placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <div className="lg:col-span-3 border border-zinc-800 bg-[#0c0c0e] p-10 text-center text-zinc-500 font-mono text-sm">
                No registered patients
              </div>
            )}
            {filtered.map((p) => {
              const grant = accessGrants.find((g) => g.patient_address_lower === p.address.toLowerCase());
              return (
                <motion.div
                  key={p.address}
                  className="border border-zinc-800 bg-[#0c0c0e] p-5 hover:border-terminal/40 transition-colors"
                  whileHover={{ y: -2 }}
                  data-testid={`patient-card-${p.address.toLowerCase()}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-display font-semibold text-lg">{p.name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">patient</div>
                    </div>
                    {grant ? <StatusBadge status="approved" /> : <StatusBadge status="pending" />}
                  </div>
                  <Hash value={p.did} label="did" testId={`patient-did-${p.address.toLowerCase()}`} />
                  <div className="mt-2">
                    <Hash value={p.address} label="wallet" testId={`patient-addr-${p.address.toLowerCase()}`} />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => { setSelected(p); toast.info("Patient selected", { description: p.name }); }}
                      data-testid={`select-${p.address.toLowerCase()}-btn`}
                      className="rounded-none bg-zinc-800 hover:bg-zinc-700 text-white font-mono uppercase text-[10px] h-8 flex-1"
                    >
                      Select
                    </Button>
                    {!grant && (
                      <Button
                        size="sm"
                        onClick={() => sendRequest(p)}
                        data-testid={`req-${p.address.toLowerCase()}-btn`}
                        className="rounded-none bg-terminal text-black font-mono uppercase text-[10px] h-8 flex-1 hover:bg-[#00cc33]"
                      >
                        Request History
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        {/* Upload */}
        <TabsContent value="upload" className="pt-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-px bg-zinc-800 border border-zinc-800">
            <div className="bg-[#0c0c0e] p-6 lg:col-span-2">
              <div className="label-eyebrow mb-2">step 01 // input</div>
              <h3 className="heading-display text-xl font-medium mb-4">New Medical Record</h3>

              <div className="space-y-4">
                <div>
                  <Label className="label-eyebrow">selected patient</Label>
                  <div className="mt-1 border border-zinc-800 p-3 bg-[#09090b] min-h-[48px]" data-testid="selected-patient-box">
                    {selected ? (
                      <div>
                        <div className="font-mono text-sm">{selected.name}</div>
                        <div className="text-[10px] text-terminal font-mono">{selected.did}</div>
                      </div>
                    ) : (
                      <div className="text-zinc-500 font-mono text-xs">choose a patient from search tab</div>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="label-eyebrow">diagnosis / title</Label>
                  <Input
                    data-testid="diagnosis-input"
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="e.g. Annual checkup abstract"
                    className="rounded-none bg-[#09090b] border-zinc-800 font-mono text-sm mt-1"
                  />
                </div>

                <div>
                  <Label className="label-eyebrow">clinical notes</Label>
                  <Textarea
                    data-testid="notes-input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="rounded-none bg-[#09090b] border-zinc-800 font-mono text-sm mt-1"
                  />
                </div>

                <div>
                  <Label className="label-eyebrow">file (PDF / abstract)</Label>
                  <Input
                    data-testid="file-input"
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="rounded-none bg-[#09090b] border-zinc-800 font-mono text-xs mt-1 file:bg-zinc-800 file:text-terminal file:border-0 file:px-3 file:py-1 file:mr-3 file:font-mono file:uppercase file:text-[10px]"
                  />
                  {file && <div className="text-[10px] text-zinc-500 font-mono mt-1">{file.name} :: {(file.size / 1024).toFixed(1)} KB</div>}
                </div>

                <Button
                  data-testid="submit-record-btn"
                  onClick={uploadRecord}
                  disabled={!selected || !file || !diagnosis}
                  className="rounded-none bg-terminal text-black font-mono uppercase tracking-widest text-sm hover:bg-[#00cc33] w-full h-12"
                >
                  <UploadSimple size={16} weight="bold" className="mr-2" />Encrypt & Submit
                </Button>
              </div>
            </div>

            <div className="bg-[#0c0c0e] p-6 lg:col-span-3">
              <div className="label-eyebrow mb-2">step 02 // pipeline</div>
              <h3 className="heading-display text-xl font-medium mb-4">Cryptographic Pipeline</h3>

              <div className="space-y-2">
                <AnimatePresence>
                  {pipeline.length === 0 && (
                    <div className="border border-zinc-800 p-12 text-center text-zinc-500 font-mono text-xs">
                      pipeline idle :: awaiting submission
                    </div>
                  )}
                  {pipeline.map((s, i) => {
                    const Icon = STAGE_ICONS[s.stage] || FileLock;
                    return (
                      <motion.div
                        key={s.stage}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={`border p-3 flex items-start gap-3 ${
                          s.status === "active"
                            ? "border-amber/60 bg-amber/5"
                            : s.status === "done"
                            ? "border-terminal/40 bg-terminal/5"
                            : s.status === "error"
                            ? "border-danger/40 bg-danger/5"
                            : "border-zinc-800"
                        }`}
                        data-testid={`pipeline-${s.stage}`}
                      >
                        <Icon size={18} weight="bold" className={
                          s.status === "active" ? "text-amber animate-pulse" :
                          s.status === "done" ? "text-terminal" :
                          s.status === "error" ? "text-danger" : "text-zinc-500"
                        } />
                        <div className="flex-1 min-w-0">
                          <div className="label-eyebrow flex justify-between">
                            <span>{s.stage}</span>
                            <span className={
                              s.status === "active" ? "text-amber" :
                              s.status === "done" ? "text-terminal" :
                              s.status === "error" ? "text-danger" : ""
                            }>{s.status}</span>
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

        {/* Records */}
        <TabsContent value="records" className="pt-8 space-y-8">
          <div>
            <div className="label-eyebrow mb-3">uploaded by you</div>
            <div className="border border-zinc-800 bg-[#0c0c0e]">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="label-eyebrow">Date</TableHead>
                    <TableHead className="label-eyebrow">Patient</TableHead>
                    <TableHead className="label-eyebrow">Diagnosis</TableHead>
                    <TableHead className="label-eyebrow">CID</TableHead>
                    <TableHead className="label-eyebrow">Anchor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.uploaded.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-zinc-500 font-mono py-10">No uploads yet</TableCell></TableRow>}
                  {records.uploaded.map((r) => (
                    <TableRow key={r.id} className="border-zinc-800" data-testid={`my-rec-${r.id}`}>
                      <TableCell className="font-mono text-xs text-zinc-400">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-sm">{r.patient_name} <span className="text-zinc-500 ml-1 text-[10px]">{shortAddr(r.patient_address)}</span></TableCell>
                      <TableCell className="font-mono text-sm text-zinc-200">{r.diagnosis}</TableCell>
                      <TableCell><Hash value={r.cid} testId={`d-cid-${r.id}`} /></TableCell>
                      <TableCell><StatusBadge status={r.anchor_status} />{r.merkle_root && <div className="mt-1"><Hash value={r.merkle_root} testId={`d-root-${r.id}`} /></div>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <div className="label-eyebrow mb-3">granted access ({records.accessible.length})</div>
            <div className="border border-zinc-800 bg-[#0c0c0e]">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="label-eyebrow">Patient</TableHead>
                    <TableHead className="label-eyebrow">Uploaded By</TableHead>
                    <TableHead className="label-eyebrow">Diagnosis</TableHead>
                    <TableHead className="label-eyebrow">CID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.accessible.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-zinc-500 font-mono py-10">No granted records</TableCell></TableRow>}
                  {records.accessible.map((r) => (
                    <TableRow key={r.id} className="border-zinc-800">
                      <TableCell className="font-mono text-sm">{r.patient_name}</TableCell>
                      <TableCell className="font-mono text-sm">{r.uploader_name}</TableCell>
                      <TableCell className="font-mono text-sm">{r.diagnosis}</TableCell>
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
