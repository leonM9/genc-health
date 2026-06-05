import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import { aesDecryptBlob, importKeyB64, shortAddr } from "@/lib/crypto";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Download, FileLock, BellRinging, X, Check, FolderLock, UploadSimple, PaperPlaneTilt, Certificate, Copy } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export default function PatientDashboard() {
  const { session, buildSig } = useWallet();
  const [records, setRecords] = useState([]);
  const [requests, setRequests] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [uploadReqs, setUploadReqs] = useState([]);
  const [activeGrants, setActiveGrants] = useState([]);
  const [revoking, setRevoking] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);  // grant pending confirmation
  const [activity, setActivity] = useState([]);
  const [decrypting, setDecrypting] = useState(null);
  const [certOpen, setCertOpen] = useState(false);
  const [certData, setCertData] = useState(null);
  const [certBusy, setCertBusy] = useState(false);
  const [redactProvider, setRedactProvider] = useState(false);
  const [redactDiagnosis, setRedactDiagnosis] = useState(false);
  const [certRecord, setCertRecord] = useState(null);

  // form
  const [doctorAddr, setDoctorAddr] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const [r, q, u, ur, g, act] = await Promise.all([
      api.get(`/records/patient/${session.address}`),
      api.get(`/access/by-patient/${session.address}`),
      api.get(`/users`),
      api.get(`/upload-requests/patient/${session.address}`),
      api.get(`/access/granted-by-patient/${session.address}`),
      api.get(`/audit-log/patient/${session.address}?limit=50`),
    ]);
    setRecords(r.data);
    setRequests(q.data);
    setDoctors(u.data.filter((x) => x.role === "doctor"));
    setUploadReqs(ur.data);
    setActiveGrants(g.data);
    setActivity(act.data);
  };
  useEffect(() => { load(); }, []);

  const respond = async (req, approve) => {
    try {
      const { message, signature } = await buildSig(approve ? "grant-access" : "deny-access");
      await api.post("/access/respond", {
        request_id: req.id, patient_address: session.address, signature, message, approve,
      });
      toast.success(approve ? "Access granted" : "Access denied", { description: shortAddr(req.doctor_address) });
      load();
    } catch (e) {
      toast.error("Failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const revokeAccess = async (grant) => {
    setRevoking(grant.doctor_address_lower);
    try {
      const { message, signature } = await buildSig("revoke-access");
      await api.post("/access/revoke", {
        patient_address: session.address,
        doctor_address: grant.doctor_address,
        signature, message,
      });
      toast.success("Access revoked", { description: `${grant.doctor_name || shortAddr(grant.doctor_address)} can no longer decrypt your records` });
      setConfirmRevoke(null);
      load();
    } catch (e) {
      toast.error("Revoke failed", { description: e?.response?.data?.detail || e.message });
    } finally {
      setRevoking(null);
    }
  };

  const decryptAndDownload = async (rec) => {
    setDecrypting(rec.id);
    try {
      const { message, signature } = await buildSig("decrypt-record");
      const r = await api.post("/records/decrypt-key", {
        record_id: rec.id, requester_address: session.address, signature, message,
      });
      const cipher = await api.get(`/ipfs/gateway/${rec.cid}`, { responseType: "blob" });
      const key = await importKeyB64(r.data.encrypted_key_b64);
      const plain = await aesDecryptBlob(cipher.data, key);
      const url = URL.createObjectURL(plain);
      const a = document.createElement("a"); a.href = url; a.download = rec.file_name; a.click(); URL.revokeObjectURL(url);
      toast.success("Decrypted locally", { description: rec.file_name });
    } catch (e) {
      toast.error("Decryption failed", { description: e?.response?.data?.detail || e.message });
    } finally { setDecrypting(null); }
  };

  const submitUploadRequest = async () => {
    if (!doctorAddr) return toast.error("Pick a doctor");
    if (!title.trim()) return toast.error("Enter a title");
    setSubmitting(true);
    try {
      const { message, signature } = await buildSig("upload-request");
      await api.post("/upload-requests", {
        patient_address: session.address,
        patient_signature: signature,
        patient_message: message,
        doctor_address: doctorAddr,
        title,
        reason,
      });
      toast.success("Upload request sent", { description: "The doctor will be notified" });
      setTitle(""); setReason(""); setDoctorAddr("");
      load();
    } catch (e) {
      toast.error("Request failed", { description: e?.response?.data?.detail || e.message });
    } finally { setSubmitting(false); }
  };

  const generateCertificate = async (rec) => {
    setCertBusy(true);
    setCertRecord(rec);
    try {
      const { message, signature } = await buildSig("issue-certificate");
      const r = await api.post("/certificate/generate", {
        record_id: rec.id,
        requester_address: session.address,
        signature, message,
        redact_provider: redactProvider,
        redact_diagnosis: redactDiagnosis,
      });
      setCertData(r.data);
      setCertOpen(true);
    } catch (e) {
      toast.error("Certificate failed", { description: e?.response?.data?.detail || e.message });
    } finally { setCertBusy(false); }
  };

  const downloadCert = () => {
    if (!certData) return;
    const blob = new Blob([JSON.stringify(certData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gen-c-cert-${certData.record.cid.slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    if (!certData) return;
    const b64 = btoa(JSON.stringify(certData));
    const url = `${window.location.origin}/verify#cert=${encodeURIComponent(b64)}`;
    const ok = await copyToClipboard(url);
    if (ok) toast.success("Share link copied", { description: "Anyone with this link can verify the proof" });
    else toast.error("Copy blocked — please select and copy manually");
  };

  const regenerate = async () => {
    if (!certRecord) return;
    await generateCertificate(certRecord);
  };

  const pendingAccess = requests.filter((r) => r.status === "pending");
  const otherAccess = requests.filter((r) => r.status !== "pending");

  return (
    <Layout
      role="patient // medical vault"
      title="Your Medical Vault"
      subtitle={`DID :: ${session.profile?.did || "did:genc:patient"} — every record encrypted client-side under your wallet key.`}
    >
      <div className="card-modern p-6 mb-10 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="eyebrow mb-2">your wallet</div>
          <Hash value={session.address} testId="patient-wallet" />
        </div>
        {pendingAccess.length > 0 && (
          <div className="flex items-center gap-2 text-amber font-mono text-sm">
            <BellRinging size={18} weight="fill" className="animate-pulse" />
            {pendingAccess.length} pending access request{pendingAccess.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

      <Tabs defaultValue="records">
        <TabsList className="bg-zinc-900/60 border border-white/5 rounded-xl p-1 mb-6 flex-wrap">
          {[
            { v: "records", l: "Records", i: FolderLock },
            { v: "access", l: `Access (${pendingAccess.length})`, i: BellRinging },
            { v: "upload", l: "Request Upload", i: UploadSimple },
          ].map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}
              className="rounded-lg font-medium text-xs uppercase tracking-wider data-[state=active]:bg-sky-500 data-[state=active]:text-zinc-950 data-[state=active]:shadow-glow px-5 py-2">
              <t.i size={14} weight="bold" className="mr-2" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="records">
          <div className="card-modern overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="eyebrow">Date</TableHead>
                  <TableHead className="eyebrow">Provider</TableHead>
                  <TableHead className="eyebrow">Diagnosis</TableHead>
                  <TableHead className="eyebrow">CID</TableHead>
                  <TableHead className="eyebrow">Status</TableHead>
                  <TableHead className="eyebrow">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-16 text-center text-zinc-500 font-mono">
                    <FileLock size={36} weight="duotone" className="mx-auto mb-3 text-zinc-700" />
                    No records yet. Use "Request Upload" to ask a doctor to add one.
                  </TableCell></TableRow>
                )}
                {records.map((r) => (
                  <TableRow key={r.id} className="border-white/5 hover:bg-white/[0.02]" data-testid={`record-row-${r.id}`}>
                    <TableCell className="font-mono text-xs text-zinc-400">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.uploader_name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">{r.uploader_department}</div>
                    </TableCell>
                    <TableCell className="font-medium">{r.diagnosis}</TableCell>
                    <TableCell className="max-w-[220px]"><Hash value={r.cid} sensitive testId={`rec-cid-${r.id}`} /></TableCell>
                    <TableCell><StatusBadge status={r.anchor_status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => decryptAndDownload(r)}
                          disabled={decrypting === r.id}
                          data-testid={`decrypt-${r.id}-btn`}
                          className="btn-primary-modern h-8 px-3 text-[11px] flex items-center gap-1.5"
                        >
                          <Download size={12} weight="bold" />
                          {decrypting === r.id ? "decrypting…" : "decrypt"}
                        </button>
                        {r.anchor_status === "anchored" && (
                          <button
                            onClick={() => generateCertificate(r)}
                            data-testid={`cert-${r.id}-btn`}
                            disabled={certBusy}
                            className="h-8 px-3 rounded-lg border border-sky-400/30 bg-sky-500/5 text-sky-300 font-mono uppercase tracking-wider text-[11px] hover:bg-sky-500/10 flex items-center gap-1.5"
                          >
                            <Certificate size={12} weight="bold" />
                            certify
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          {pendingAccess.length === 0 && otherAccess.length === 0 && activeGrants.length === 0 && (
            <div className="card-modern p-16 text-center text-zinc-500 font-mono text-sm">No access requests</div>
          )}

          {/* ACTIVE GRANTS — currently-approved doctors with a Revoke button */}
          {activeGrants.length > 0 && (
            <div className="card-modern overflow-hidden border-emerald/30" data-testid="active-grants-panel">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <div>
                  <div className="eyebrow text-emerald">active grants ({activeGrants.length})</div>
                  <div className="text-[11px] text-zinc-500 font-mono mt-1">Doctors who can currently decrypt your records. Revoke any anytime.</div>
                </div>
              </div>
              <Table>
                <TableBody>
                  {activeGrants.map((g) => (
                    <TableRow key={g.doctor_address_lower} className="border-white/5" data-testid={`grant-${g.doctor_address_lower}`}>
                      <TableCell className="py-3">
                        <div className="font-medium text-sm">{g.doctor_name || "Unknown doctor"}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          {g.doctor_department || "—"}{g.doctor_hospital ? ` · ${g.doctor_hospital}` : ""}
                        </div>
                      </TableCell>
                      <TableCell><Hash value={g.doctor_address} testId={`grant-addr-${g.doctor_address_lower}`} /></TableCell>
                      <TableCell className="font-mono text-[10px] text-zinc-500">
                        approved · {new Date(g.approved_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => setConfirmRevoke(g)}
                          disabled={revoking === g.doctor_address_lower}
                          data-testid={`revoke-${g.doctor_address_lower}-btn`}
                          className="h-9 px-4 rounded-lg border border-rose/40 bg-rose/5 text-rose font-semibold text-xs hover:bg-rose/15 disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <X size={12} weight="bold" />
                          {revoking === g.doctor_address_lower ? "Revoking…" : "Revoke & Sign"}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {pendingAccess.map((req) => (
            <div key={req.id} className="card-modern p-5 border-amber/30" data-testid={`req-${req.id}`}>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="eyebrow mb-1 text-amber">pending request</div>
                  <div className="font-medium text-sm mb-3">Doctor wants to view your medical history</div>
                  <Hash value={req.doctor_address} label="doctor" testId={`req-doctor-${req.id}`} />
                  {req.reason && <div className="text-zinc-400 text-xs mt-2 font-mono">reason: {req.reason}</div>}
                  <div className="text-[10px] text-zinc-500 mt-2 font-mono">{new Date(req.created_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2 sm:flex-col">
                  <button onClick={() => respond(req, true)} data-testid={`approve-${req.id}-btn`}
                    className="btn-primary-modern h-10 px-5 text-xs flex items-center gap-2"><Check size={14} weight="bold" />Approve & Sign</button>
                  <button onClick={() => respond(req, false)} data-testid={`deny-${req.id}-btn`}
                    className="h-10 px-5 rounded-lg border border-rose/30 bg-rose/5 text-rose font-semibold text-xs hover:bg-rose/10 flex items-center gap-2"><X size={14} weight="bold" />Deny</button>
                </div>
              </div>
            </div>
          ))}
          {otherAccess.length > 0 && (
            <div className="card-modern overflow-hidden">
              <div className="eyebrow p-4 border-b border-white/5">history</div>
              <Table>
                <TableBody>
                  {otherAccess.map((req) => (
                    <TableRow key={req.id} className="border-white/5">
                      <TableCell><StatusBadge status={req.status} /></TableCell>
                      <TableCell><Hash value={req.doctor_address} testId={`hist-${req.id}`} /></TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">{new Date(req.responded_at || req.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* My Activity — read-only audit-log slice for THIS patient */}
          {activity.length > 0 && (
            <div className="card-modern overflow-hidden" data-testid="patient-activity-panel">
              <div className="p-4 border-b border-white/5">
                <div className="eyebrow text-sky-400">my activity · ra 10173 trail</div>
                <div className="text-[11px] text-zinc-500 font-mono mt-1">
                  Every action involving your data, signed and hashed. Last {activity.length} events.
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <Table>
                  <TableBody>
                    {activity.map((ev) => (
                      <TableRow key={ev.id} className="border-white/5" data-testid={`activity-${ev.id}`}>
                        <TableCell className="py-2.5">
                          <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${
                            ev.event_type.startsWith("access.revoke") || ev.event_type === "record.delete"
                              ? "border-rose/40 bg-rose/5 text-rose"
                              : ev.event_type.endsWith("denied")
                              ? "border-amber/40 bg-amber/5 text-amber"
                              : "border-sky-400/30 bg-sky-500/5 text-sky-400"
                          }`}>{ev.event_type}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-[11px] text-zinc-400 font-mono">
                          {ev.actor_role || "—"}
                          {ev.subject_address && <span className="text-zinc-600"> · w/ {shortAddr(ev.subject_address)}</span>}
                        </TableCell>
                        <TableCell className="py-2.5 font-mono text-[10px] text-zinc-500 whitespace-nowrap text-right">
                          {new Date(ev.ts).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="upload">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="card-modern p-6 lg:col-span-2">
              <div className="eyebrow mb-1">step 01 // request</div>
              <h3 className="heading-display text-xl font-bold mb-4">Ask a Doctor to Upload</h3>
              <p className="text-zinc-400 text-sm mb-5">Send a signed request. The doctor receives it in their inbox and uploads the encrypted record on your behalf.</p>

              <div className="space-y-4">
                <div>
                  <Label className="eyebrow">choose a doctor</Label>
                  <Select value={doctorAddr} onValueChange={setDoctorAddr}>
                    <SelectTrigger data-testid="ur-doctor-select" className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5">
                      <SelectValue placeholder="select a doctor" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg bg-zinc-900 border-white/10">
                      {doctors.length === 0 && <SelectItem disabled value="none">No doctors registered yet</SelectItem>}
                      {doctors.map((d) => (
                        <SelectItem key={d.address} value={d.address}>
                          {d.name} · {d.department} {d.hospital ? `· ${d.hospital}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="eyebrow">title</Label>
                  <Input data-testid="ur-title-input" value={title} onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Lab results from last week"
                    className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>

                <div>
                  <Label className="eyebrow">message</Label>
                  <Textarea data-testid="ur-reason-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="Any notes for the doctor…"
                    className="mt-1.5 rounded-lg bg-zinc-900/60 border-white/5" />
                </div>

                <button onClick={submitUploadRequest} disabled={submitting}
                  data-testid="ur-submit-btn"
                  className="btn-primary-modern w-full h-12 flex items-center justify-center gap-2 text-sm font-semibold">
                  <PaperPlaneTilt size={16} weight="bold" />
                  {submitting ? "signing & sending…" : "Sign & Send Request"}
                </button>
              </div>
            </div>

            <div className="card-modern p-6 lg:col-span-3">
              <div className="eyebrow mb-1">step 02 // status</div>
              <h3 className="heading-display text-xl font-bold mb-4">Your Upload Requests</h3>
              <div className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/5 hover:bg-transparent">
                      <TableHead className="eyebrow">When</TableHead>
                      <TableHead className="eyebrow">Doctor</TableHead>
                      <TableHead className="eyebrow">Title</TableHead>
                      <TableHead className="eyebrow">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uploadReqs.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-zinc-500 font-mono py-12">No upload requests yet</TableCell></TableRow>}
                    {uploadReqs.map((u) => (
                      <TableRow key={u.id} className="border-white/5" data-testid={`ur-row-${u.id}`}>
                        <TableCell className="font-mono text-xs text-zinc-400">{new Date(u.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{u.doctor_name}</div>
                          <div className="text-[10px] text-zinc-500 font-mono">{u.doctor_department}{u.doctor_hospital && ` · ${u.doctor_hospital}`}</div>
                        </TableCell>
                        <TableCell className="font-medium">{u.title}</TableCell>
                        <TableCell><StatusBadge status={u.status === "fulfilled" ? "anchored" : u.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={certOpen} onOpenChange={setCertOpen}>
        <DialogContent className="bg-zinc-950 border border-white/10 rounded-2xl max-w-2xl text-zinc-100">
          <DialogHeader>
            <div className="eyebrow mb-1">zero-knowledge attestation</div>
            <DialogTitle className="heading-display text-2xl font-bold flex items-center gap-2">
              <Certificate size={24} weight="duotone" className="text-sky-400" />
              Verification Certificate
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/60 border border-white/5">
              <div className="text-xs text-zinc-300">Redact provider identity</div>
              <Switch checked={redactProvider} onCheckedChange={setRedactProvider} data-testid="redact-provider-switch" />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/60 border border-white/5">
              <div className="text-xs text-zinc-300">Redact diagnosis</div>
              <Switch checked={redactDiagnosis} onCheckedChange={setRedactDiagnosis} data-testid="redact-diagnosis-switch" />
            </div>
            <button onClick={regenerate} disabled={certBusy} data-testid="regen-cert-btn"
              className="w-full h-9 btn-ghost-modern text-xs font-semibold">
              {certBusy ? "regenerating…" : "Regenerate with current settings"}
            </button>

            {certData && (
              <>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-zinc-900/60 border border-white/5">
                    <div className="eyebrow !text-[9px]">block</div>
                    <div className="font-mono text-sky-400 mt-1">#{certData.record.block_number}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-900/60 border border-white/5">
                    <div className="eyebrow !text-[9px]">leaves</div>
                    <div className="font-mono mt-1">{certData.record.leaf_count}</div>
                  </div>
                </div>
                <Hash value={certData.record.merkle_root} label="root" testId="cert-root" />
                <Hash value={certData.record.tx_hash} label="tx" testId="cert-tx" />
                <div className="rounded-lg bg-zinc-900/80 border border-white/5 p-3 max-h-[180px] overflow-auto">
                  <pre className="text-[10px] font-mono text-zinc-300">{JSON.stringify(certData, null, 2)}</pre>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 mt-2">
            <button onClick={copyShareLink} disabled={!certData} data-testid="copy-share-btn"
              className="btn-ghost-modern h-10 px-4 text-xs font-semibold flex items-center gap-2">
              <Copy size={14} weight="bold" /> Copy share link
            </button>
            <button onClick={downloadCert} disabled={!certData} data-testid="download-cert-btn"
              className="btn-primary-modern h-10 px-5 text-xs font-semibold flex items-center gap-2">
              <Download size={14} weight="bold" /> Download .json
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REVOKE ACCESS CONFIRMATION (native window.confirm is blocked inside Emergent's iframe) */}
      <Dialog open={!!confirmRevoke} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <DialogContent className="max-w-md rounded-2xl bg-zinc-950 border-rose/30" data-testid="confirm-revoke-modal">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Revoke doctor access?</DialogTitle>
          </DialogHeader>
          {confirmRevoke && (
            <div className="space-y-4">
              <div className="rounded-lg border border-rose/30 bg-rose/5 p-4">
                <div className="eyebrow !text-rose mb-2">about to revoke</div>
                <div className="font-medium text-sm">{confirmRevoke.doctor_name || "Unknown doctor"}</div>
                <div className="text-[11px] text-zinc-500 font-mono mt-1">
                  {confirmRevoke.doctor_department || "—"}
                  {confirmRevoke.doctor_hospital ? ` · ${confirmRevoke.doctor_hospital}` : ""}
                </div>
                <div className="text-[10px] text-zinc-600 font-mono mt-2 break-all">{confirmRevoke.doctor_address}</div>
              </div>
              <ul className="text-xs text-zinc-400 space-y-2 list-disc pl-5">
                <li>The doctor will <span className="text-rose font-medium">immediately</span> lose decrypt rights to your records.</li>
                <li>You will sign a revocation message with your wallet (RA 10173 §16 — Right to Withdraw Consent).</li>
                <li>The doctor must request access again if you change your mind.</li>
              </ul>
            </div>
          )}
          <DialogFooter className="gap-2 mt-2">
            <button
              onClick={() => setConfirmRevoke(null)}
              disabled={!!revoking}
              data-testid="cancel-revoke-btn"
              className="btn-ghost-modern h-10 px-5 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmRevoke && revokeAccess(confirmRevoke)}
              disabled={!!revoking}
              data-testid="confirm-revoke-btn"
              className="h-10 px-5 rounded-lg border border-rose/40 bg-rose/10 text-rose font-semibold text-xs hover:bg-rose/20 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <X size={14} weight="bold" />
              {revoking ? "Revoking…" : "Revoke & Sign"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
