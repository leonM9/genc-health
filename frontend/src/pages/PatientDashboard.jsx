import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
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
        request_id: req.id,
        patient_address: session.address,
        signature,
        message,
        approve,
      });
      toast.success(approve ? "Access granted" : "Access denied", {
        description: shortAddr(req.doctor_address),
      });
      load();
    } catch (e) {
      toast.error("Failed", { description: e.response?.data?.detail || e.message });
    }
  };

  const decryptAndDownload = async (rec) => {
    setDecrypting(rec.id);
    try {
      // 1. Request key (server validates policy + signature)
      const { message, signature } = await buildSig("decrypt-record");
      const r = await api.post("/records/decrypt-key", {
        record_id: rec.id,
        requester_address: session.address,
        signature,
        message,
      });
      // 2. Fetch ciphertext from IPFS gateway via backend
      const cipherResp = await api.get(`/ipfs/gateway/${rec.cid}`, { responseType: "blob" });
      // 3. Decrypt
      const key = await importKeyB64(r.data.encrypted_key_b64);
      const plain = await aesDecryptBlob(cipherResp.data, key);
      // 4. Trigger download
      const url = URL.createObjectURL(plain);
      const a = document.createElement("a");
      a.href = url;
      a.download = rec.file_name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Decrypted locally", { description: rec.file_name });
    } catch (e) {
      toast.error("Decryption failed", { description: e.response?.data?.detail || e.message });
    } finally {
      setDecrypting(null);
    }
  };

  const pendingReq = requests.filter((r) => r.status === "pending");
  const otherReq = requests.filter((r) => r.status !== "pending");

  return (
    <Layout
      role="patient :: wallet"
      title="Your Medical Vault"
      subtitle={`DID :: ${session.profile?.did || "did:genc:patient"} :: All records encrypted client-side under your wallet key.`}
    >
      <div className="border border-zinc-800 bg-[#0c0c0e] p-6 mb-10 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
        <div>
          <div className="label-eyebrow mb-1">your wallet</div>
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
        <TabsList className="rounded-none bg-transparent border-b border-zinc-800 w-full justify-start h-auto p-0 gap-0">
          {[
            { v: "records", l: "Records", i: FolderLock },
            { v: "requests", l: `Access Requests (${pendingReq.length})`, i: BellRinging },
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

        <TabsContent value="records" className="pt-8">
          <div className="border border-zinc-800 bg-[#0c0c0e]">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="label-eyebrow">Date</TableHead>
                  <TableHead className="label-eyebrow">Provider</TableHead>
                  <TableHead className="label-eyebrow">Diagnosis</TableHead>
                  <TableHead className="label-eyebrow">CID</TableHead>
                  <TableHead className="label-eyebrow">Status</TableHead>
                  <TableHead className="label-eyebrow">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-16 text-center text-zinc-500 font-mono">
                    <FileLock size={32} weight="thin" className="mx-auto mb-3 text-zinc-700" />
                    No records yet. A doctor must upload them.
                  </TableCell></TableRow>
                )}
                {records.map((r) => (
                  <TableRow key={r.id} className="border-zinc-800 hover:bg-zinc-900/40" data-testid={`record-row-${r.id}`}>
                    <TableCell className="font-mono text-xs text-zinc-400">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-sm">{r.uploader_name}<div className="text-[10px] text-zinc-500">{r.uploader_department}</div></TableCell>
                    <TableCell className="font-mono text-sm text-zinc-200">{r.diagnosis}</TableCell>
                    <TableCell className="max-w-[200px]"><Hash value={r.cid} testId={`rec-cid-${r.id}`} /></TableCell>
                    <TableCell><StatusBadge status={r.anchor_status} /></TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => decryptAndDownload(r)}
                        disabled={decrypting === r.id}
                        data-testid={`decrypt-${r.id}-btn`}
                        className="rounded-none bg-terminal text-black font-mono uppercase tracking-widest text-[10px] hover:bg-[#00cc33] h-8"
                      >
                        <Download size={12} weight="bold" className="mr-1" />
                        {decrypting === r.id ? "decrypting…" : "decrypt"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="requests" className="pt-8 space-y-4">
          {pendingReq.length === 0 && otherReq.length === 0 && (
            <div className="border border-zinc-800 bg-[#0c0c0e] p-12 text-center text-zinc-500 font-mono text-sm">
              No access requests
            </div>
          )}
          {pendingReq.map((req) => (
            <div key={req.id} className="border border-amber/40 bg-[#0c0c0e] p-5" data-testid={`req-${req.id}`}>
              <div className="flex justify-between items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[280px]">
                  <div className="label-eyebrow mb-1 text-amber">pending request</div>
                  <div className="font-mono text-sm mb-2">
                    Doctor wants to view your medical history
                  </div>
                  <Hash value={req.doctor_address} label="doctor" testId={`req-doctor-${req.id}`} />
                  {req.reason && <div className="text-zinc-400 text-xs mt-2 font-mono">reason: {req.reason}</div>}
                  <div className="text-[10px] text-zinc-500 mt-1 font-mono">{new Date(req.created_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => respond(req, true)}
                    data-testid={`approve-${req.id}-btn`}
                    className="rounded-none bg-terminal text-black font-mono uppercase text-xs h-10 px-5"
                  >
                    <Check size={14} weight="bold" className="mr-1" />Approve & Sign
                  </Button>
                  <Button
                    onClick={() => respond(req, false)}
                    variant="outline"
                    data-testid={`deny-${req.id}-btn`}
                    className="rounded-none border-danger/40 text-danger font-mono uppercase text-xs h-10 px-5 hover:bg-danger/10"
                  >
                    <X size={14} weight="bold" className="mr-1" />Deny
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {otherReq.length > 0 && (
            <div className="border border-zinc-800 bg-[#0c0c0e]">
              <div className="label-eyebrow p-4 border-b border-zinc-800">history</div>
              <Table>
                <TableBody>
                  {otherReq.map((req) => (
                    <TableRow key={req.id} className="border-zinc-800">
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
