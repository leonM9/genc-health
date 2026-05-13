import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/walletContext";
import { Hash, StatusBadge } from "@/components/CryptoString";
import MerkleVisualizer from "@/components/MerkleVisualizer";
import { merklePreview } from "@/lib/crypto";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Cube, ArrowsClockwise, Anchor, Users, TreeStructure, Stack, Stethoscope, UserCircle } from "@phosphor-icons/react";

export default function AdminDashboard() {
  const { session, buildSig } = useWallet();
  const [users, setUsers] = useState([]);
  const [pending, setPending] = useState([]);
  const [anchors, setAnchors] = useState([]);
  const [stats, setStats] = useState({});
  const [preview, setPreview] = useState({ root: "", layers: [] });
  const [anchoring, setAnchoring] = useState(false);

  const load = async () => {
    const [u, p, a, s] = await Promise.all([
      api.get("/users"), api.get("/lpa/pending"), api.get("/lpa/anchors"), api.get("/lpa/stats"),
    ]);
    setUsers(u.data); setPending(p.data); setAnchors(a.data); setStats(s.data);
    setPreview(p.data.length ? merklePreview(p.data.map((x) => x.cid)) : { root: "", layers: [] });
  };
  useEffect(() => { load(); }, []);

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

  const doctors = users.filter((u) => u.role === "doctor");
  const patients = users.filter((u) => u.role === "patient");

  const statCards = [
    { k: "Doctors", v: doctors.length, color: "text-teal-300", icon: Stethoscope },
    { k: "Patients", v: patients.length, color: "text-emerald-400", icon: UserCircle },
    { k: "Pending CIDs", v: stats.pending || 0, color: "text-amber", icon: Cube },
    { k: "Anchored Roots", v: stats.anchors || 0, color: "text-emerald-400", icon: TreeStructure },
  ];

  return (
    <Layout role="admin // network control" title="Network Control Room" subtitle="Aggregate pending CIDs into Merkle batches and anchor proofs to the chain. Doctors and patients self-register from the login screen.">
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
            { v: "anchors", l: "Anchored Roots", i: Anchor },
            { v: "doctors", l: `Doctors (${doctors.length})`, i: Stethoscope },
            { v: "patients", l: `Patients (${patients.length})`, i: UserCircle },
          ].map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}
              className="rounded-lg font-medium text-xs uppercase tracking-wider data-[state=active]:bg-emerald-500 data-[state=active]:text-zinc-950 data-[state=active]:shadow-glow px-5 py-2">
              <t.i size={14} weight="bold" className="mr-2" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="lpa">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
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
                      <Checkbox checked disabled className="rounded border-emerald-400 data-[state=checked]:bg-emerald-400 data-[state=checked]:text-zinc-950" />
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
            </div>

            <div className="card-modern p-6 lg:col-span-3">
              <div className="eyebrow mb-1">step 02 // aggregate</div>
              <h3 className="heading-display text-2xl font-bold mb-4">Merkle Tree Preview</h3>
              <MerkleVisualizer layers={preview.layers} root={preview.root} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="anchors">
          <div className="card-modern overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="eyebrow">Block</TableHead>
                  <TableHead className="eyebrow">Anchored At</TableHead>
                  <TableHead className="eyebrow">Merkle Root</TableHead>
                  <TableHead className="eyebrow">Tx Hash</TableHead>
                  <TableHead className="eyebrow">Leaves</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anchors.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-zinc-500 font-mono py-16">No anchors yet</TableCell></TableRow>}
                {anchors.map((a) => (
                  <TableRow key={a.id} className="border-white/5 hover:bg-white/[0.02]" data-testid={`anchor-row-${a.block_number}`}>
                    <TableCell className="font-mono text-sm text-emerald-400">#{a.block_number}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400">{new Date(a.anchored_at).toLocaleString()}</TableCell>
                    <TableCell><Hash value={a.root} testId={`root-${a.id}`} /></TableCell>
                    <TableCell><Hash value={a.tx_hash} testId={`tx-${a.id}`} /></TableCell>
                    <TableCell className="font-mono text-sm">{a.leaf_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="doctors">
          <div className="flex justify-between items-center mb-4">
            <h3 className="heading-display text-2xl font-bold">Registered Doctors</h3>
            <Button onClick={load} variant="ghost" data-testid="refresh-doctors-btn" className="rounded-lg text-zinc-400 hover:text-emerald-400 font-mono text-xs">
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> refresh
            </Button>
          </div>
          <div className="card-modern overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="eyebrow">Name</TableHead>
                  <TableHead className="eyebrow">Department</TableHead>
                  <TableHead className="eyebrow">Hospital / Clinic</TableHead>
                  <TableHead className="eyebrow">DID</TableHead>
                  <TableHead className="eyebrow">Wallet</TableHead>
                  <TableHead className="eyebrow">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doctors.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-zinc-500 font-mono py-16">No registered doctors yet.</TableCell></TableRow>
                )}
                {doctors.map((u) => (
                  <TableRow key={u.address} className="border-white/5 hover:bg-white/[0.02]" data-testid={`doctor-row-${u.address_lower}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2"><Stethoscope size={14} weight="duotone" className="text-teal-300" />{u.name}</div>
                    </TableCell>
                    <TableCell className="text-zinc-300 text-sm">{u.department || "—"}</TableCell>
                    <TableCell className="text-zinc-300 text-sm">{u.hospital || <span className="text-zinc-600">not set</span>}</TableCell>
                    <TableCell className="font-mono text-[11px] text-emerald-400">{u.did}</TableCell>
                    <TableCell className="max-w-[220px]"><Hash value={u.address} testId={`d-addr-${u.address_lower}`} /></TableCell>
                    <TableCell className="font-mono text-[10px] text-zinc-500">{u.created_at?.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="patients">
          <div className="flex justify-between items-center mb-4">
            <h3 className="heading-display text-2xl font-bold">Registered Patients</h3>
            <Button onClick={load} variant="ghost" data-testid="refresh-patients-btn" className="rounded-lg text-zinc-400 hover:text-emerald-400 font-mono text-xs">
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> refresh
            </Button>
          </div>
          <div className="card-modern overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="eyebrow">Name</TableHead>
                  <TableHead className="eyebrow">DID</TableHead>
                  <TableHead className="eyebrow">Wallet</TableHead>
                  <TableHead className="eyebrow">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-zinc-500 font-mono py-16">No registered patients yet.</TableCell></TableRow>
                )}
                {patients.map((u) => (
                  <TableRow key={u.address} className="border-white/5 hover:bg-white/[0.02]" data-testid={`patient-row-${u.address_lower}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2"><UserCircle size={14} weight="duotone" className="text-emerald-400" />{u.name}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-emerald-400">{u.did}</TableCell>
                    <TableCell className="max-w-[260px]"><Hash value={u.address} testId={`p-addr-${u.address_lower}`} /></TableCell>
                    <TableCell className="font-mono text-[10px] text-zinc-500">{u.created_at?.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
