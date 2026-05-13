import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import { aesDecryptBlob, importKeyB64, shortAddr } from "@/lib/crypto";
import { toast } from "sonner";
import { Download, FileLock, BellRinging, X, Check, FolderLock } from "@phosphor-icons/react";

export default function PatientDashboard() {
  const { session, buildSig } = useWallet();
  const [records, setRecords] = useState([]);
  const [requests, setRequests] = useState([]);
  const [decrypting, setDecrypting] = useState(null);

  const load = async () => {
    const [r, q] = await Promise.all([
      api.get(`/records/patient/${session.address}`),
      api.get(`/access/by-patient/${session.address}`),
    ]);
    setRecords(r.data);
    setRequests(q.data);
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

  const pendingReq = requests.filter((r) => r.status === "pending");
  const otherReq = requests.filter((r) => r.status !== "pending");

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
        {pendingReq.length > 0 && (
          <div className="flex items-center gap-2 text-amber font-mono text-sm">
            <BellRinging size={18} weight="fill" className="animate-pulse" />
            {pendingReq.length} pending access request{pendingReq.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

      <Tabs defaultValue="records">
        <TabsList className="bg-zinc-900/60 border border-white/5 rounded-xl p-1 mb-6">
          {[
            { v: "records", l: "Records", i: FolderLock },
            { v: "requests", l: `Access (${pendingReq.length})`, i: BellRinging },
          ].map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}
              className="rounded-lg font-medium text-xs uppercase tracking-wider data-[state=active]:bg-emerald-500 data-[state=active]:text-zinc-950 data-[state=active]:shadow-glow px-5 py-2">
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
                    No records yet. A doctor must upload them.
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
                    <TableCell className="max-w-[220px]"><Hash value={r.cid} testId={`rec-cid-${r.id}`} /></TableCell>
                    <TableCell><StatusBadge status={r.anchor_status} /></TableCell>
                    <TableCell>
                      <button
                        onClick={() => decryptAndDownload(r)}
                        disabled={decrypting === r.id}
                        data-testid={`decrypt-${r.id}-btn`}
                        className="btn-primary-modern h-8 px-3 text-[11px] flex items-center gap-1.5"
                      >
                        <Download size={12} weight="bold" />
                        {decrypting === r.id ? "decrypting…" : "decrypt"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          {pendingReq.length === 0 && otherReq.length === 0 && (
            <div className="card-modern p-16 text-center text-zinc-500 font-mono text-sm">No access requests</div>
          )}
          {pendingReq.map((req) => (
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
                  <button
                    onClick={() => respond(req, true)}
                    data-testid={`approve-${req.id}-btn`}
                    className="btn-primary-modern h-10 px-5 text-xs flex items-center gap-2"
                  >
                    <Check size={14} weight="bold" />Approve & Sign
                  </button>
                  <button
                    onClick={() => respond(req, false)}
                    data-testid={`deny-${req.id}-btn`}
                    className="h-10 px-5 rounded-lg border border-rose/30 bg-rose/5 text-rose font-semibold text-xs hover:bg-rose/10 flex items-center gap-2"
                  >
                    <X size={14} weight="bold" />Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
          {otherReq.length > 0 && (
            <div className="card-modern overflow-hidden">
              <div className="eyebrow p-4 border-b border-white/5">history</div>
              <Table>
                <TableBody>
                  {otherReq.map((req) => (
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
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
