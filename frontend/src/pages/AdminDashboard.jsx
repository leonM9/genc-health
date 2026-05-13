import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { UserPlus, Cube, ArrowsClockwise, Anchor, Stethoscope, Users } from "@phosphor-icons/react";

export default function AdminDashboard() {
  const { session, buildSig } = useWallet();
  const [users, setUsers] = useState([]);
  const [pending, setPending] = useState([]);
  const [anchors, setAnchors] = useState([]);
  const [stats, setStats] = useState({});
  const [preview, setPreview] = useState({ root: "", layers: [] });
  const [selected, setSelected] = useState({});

  // form
  const [form, setForm] = useState({ role: "patient", name: "", address: "", department: "", did: "" });

  const load = async () => {
    const [u, p, a, s] = await Promise.all([
      api.get("/users"),
      api.get("/lpa/pending"),
      api.get("/lpa/anchors"),
      api.get("/lpa/stats"),
    ]);
    setUsers(u.data);
    setPending(p.data);
    setAnchors(a.data);
    setStats(s.data);
    if (p.data.length > 0) {
      setPreview(merklePreview(p.data.map((x) => x.cid)));
    } else {
      setPreview({ root: "", layers: [] });
    }
  };

  useEffect(() => { load(); }, []);

  const register = async (e) => {
    e.preventDefault();
    try {
      const { message, signature } = await buildSig("register-user");
      const r = await api.post("/users/register", {
        actor_address: session.address,
        actor_signature: signature,
        actor_message: message,
        role: form.role,
        name: form.name,
        address: form.address,
        department: form.role === "doctor" ? form.department : null,
        did: form.did || null,
      });
      toast.success("User registered", { description: r.data.did });
      setForm({ role: "patient", name: "", address: "", department: "", did: "" });
      load();
    } catch (e) {
      toast.error("Registration failed", { description: e.response?.data?.detail || e.message });
    }
  };

  const anchor = async () => {
    try {
      const { message, signature } = await buildSig("anchor-merkle-root");
      const r = await api.post("/lpa/anchor", {
        admin_address: session.address,
        signature,
        message,
      });
      toast.success("Merkle Root anchored", { description: r.data.root.slice(0, 18) + "…" });
      load();
    } catch (e) {
      toast.error("Anchor failed", { description: e.response?.data?.detail || e.message });
    }
  };

  return (
    <Layout role="admin :: registry" title="Registry & LPA Console" subtitle="Manage user registry. Aggregate pending CIDs into Merkle batches and anchor roots on-chain.">
      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-zinc-800 border border-zinc-800 mb-10">
        {[
          { k: "Users", v: stats.users || 0, c: "text-zinc-200" },
          { k: "Records", v: stats.records || 0, c: "text-zinc-200" },
          { k: "Pending CIDs", v: stats.pending || 0, c: "text-amber" },
          { k: "Anchored Roots", v: stats.anchors || 0, c: "text-terminal" },
        ].map((s) => (
          <div key={s.k} className="bg-[#0c0c0e] p-5">
            <div className="label-eyebrow">{s.k}</div>
            <div className={`font-display font-bold text-4xl mt-2 ${s.c}`} data-testid={`stat-${s.k.toLowerCase().replace(" ", "-")}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="registry">
        <TabsList className="rounded-none bg-transparent border-b border-zinc-800 w-full justify-start h-auto p-0 gap-0">
          {[
            { v: "registry", l: "Registry", i: Users },
            { v: "lpa", l: "LPA Batch", i: Cube },
            { v: "anchors", l: "Anchored Roots", i: Anchor },
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

        {/* Registry */}
        <TabsContent value="registry" className="pt-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-zinc-800 border border-zinc-800">
            <div className="bg-[#0c0c0e] p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserPlus size={18} weight="bold" className="text-terminal" />
                <h3 className="heading-display text-xl font-medium">Register User</h3>
              </div>
              <form onSubmit={register} className="space-y-4">
                <div>
                  <Label className="label-eyebrow">role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger data-testid="register-role-select" className="rounded-none bg-[#09090b] border-zinc-800 font-mono text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-none bg-[#0c0c0e] border-zinc-800">
                      <SelectItem value="patient">Patient</SelectItem>
                      <SelectItem value="doctor">Doctor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="label-eyebrow">full name</Label>
                  <Input data-testid="register-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-none bg-[#09090b] border-zinc-800 font-mono mt-1" />
                </div>
                <div>
                  <Label className="label-eyebrow">wallet address</Label>
                  <Input data-testid="register-address-input" required placeholder="0x..." value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-none bg-[#09090b] border-zinc-800 font-mono mt-1 text-xs" />
                </div>
                {form.role === "doctor" && (
                  <div>
                    <Label className="label-eyebrow">department</Label>
                    <Input data-testid="register-dept-input" placeholder="Cardiology, Pediatrics, ..." value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="rounded-none bg-[#09090b] border-zinc-800 font-mono mt-1" />
                  </div>
                )}
                <div>
                  <Label className="label-eyebrow">did (optional)</Label>
                  <Input data-testid="register-did-input" placeholder="did:genc:patient:..." value={form.did} onChange={(e) => setForm({ ...form, did: e.target.value })} className="rounded-none bg-[#09090b] border-zinc-800 font-mono mt-1 text-xs" />
                </div>
                <Button type="submit" data-testid="register-submit-btn" className="rounded-none bg-terminal text-black font-mono uppercase tracking-widest text-sm hover:bg-[#00cc33] w-full h-11">
                  Sign & Register
                </Button>
              </form>
            </div>

            <div className="bg-[#0c0c0e] p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Stethoscope size={18} weight="bold" className="text-amber" />
                  <h3 className="heading-display text-xl font-medium">Registered Users ({users.length})</h3>
                </div>
                <Button onClick={load} variant="ghost" data-testid="refresh-users-btn" className="rounded-none text-zinc-400 hover:text-terminal font-mono text-xs">
                  <ArrowsClockwise size={14} weight="bold" className="mr-1" /> refresh
                </Button>
              </div>
              <div className="max-h-[480px] overflow-y-auto border border-zinc-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="label-eyebrow">Role</TableHead>
                      <TableHead className="label-eyebrow">Name</TableHead>
                      <TableHead className="label-eyebrow">DID / Wallet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-zinc-500 font-mono py-8">No users yet</TableCell></TableRow>
                    )}
                    {users.map((u) => (
                      <TableRow key={u.address} className="border-zinc-800 hover:bg-zinc-900/50" data-testid={`user-row-${u.address_lower}`}>
                        <TableCell className="font-mono text-xs"><StatusBadge status={u.role} /></TableCell>
                        <TableCell className="font-mono text-sm">{u.name}{u.department && <span className="text-zinc-500 ml-2">· {u.department}</span>}</TableCell>
                        <TableCell className="font-mono text-xs text-terminal">{u.did}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* LPA Batch */}
        <TabsContent value="lpa" className="pt-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-px bg-zinc-800 border border-zinc-800">
            <div className="bg-[#0c0c0e] p-6 lg:col-span-2">
              <div className="label-eyebrow mb-2">step 01 // collect</div>
              <h3 className="heading-display text-2xl font-medium mb-4">Pending Transaction Batch</h3>
              <p className="text-zinc-400 text-sm mb-6">CIDs waiting to be hashed into the next Merkle root.</p>

              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {pending.length === 0 && <div className="text-zinc-500 font-mono text-sm py-8 text-center border border-zinc-800">queue empty</div>}
                {pending.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="border border-zinc-800 p-3 bg-[#09090b]"
                    data-testid={`lpa-pending-${p.cid}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Checkbox checked disabled className="rounded-none border-terminal data-[state=checked]:bg-terminal data-[state=checked]:text-black" />
                      <span className="label-eyebrow">queued</span>
                      <span className="text-zinc-500 text-[10px] font-mono ml-auto">{p.added_at?.slice(11, 19)}</span>
                    </div>
                    <Hash value={p.cid} label="cid" testId={`pending-cid-${p.cid}`} />
                    {p.patient_name && (
                      <div className="text-[11px] font-mono text-zinc-400 mt-2">
                        {p.uploader_name} → <span className="text-zinc-200">{p.patient_name}</span> :: {p.diagnosis}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>

              <Button
                onClick={anchor}
                disabled={pending.length === 0}
                data-testid="anchor-merkle-btn"
                className="rounded-none bg-terminal text-black font-mono uppercase tracking-widest text-sm hover:bg-[#00cc33] w-full h-12 mt-6"
              >
                <Anchor size={16} weight="bold" className="mr-2" />Anchor Merkle Root ({pending.length})
              </Button>
            </div>

            <div className="bg-[#0c0c0e] p-6 lg:col-span-3">
              <div className="label-eyebrow mb-2">step 02 // aggregate</div>
              <h3 className="heading-display text-2xl font-medium mb-4">Merkle Tree Preview</h3>
              <MerkleVisualizer layers={preview.layers} root={preview.root} />
            </div>
          </div>
        </TabsContent>

        {/* Anchors history */}
        <TabsContent value="anchors" className="pt-8">
          <div className="border border-zinc-800 bg-[#0c0c0e]">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="label-eyebrow">Block</TableHead>
                  <TableHead className="label-eyebrow">Anchored At</TableHead>
                  <TableHead className="label-eyebrow">Merkle Root</TableHead>
                  <TableHead className="label-eyebrow">Tx Hash</TableHead>
                  <TableHead className="label-eyebrow">Leaves</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anchors.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-zinc-500 font-mono py-12">No anchors yet</TableCell></TableRow>}
                {anchors.map((a) => (
                  <TableRow key={a.id} className="border-zinc-800 hover:bg-zinc-900/40" data-testid={`anchor-row-${a.block_number}`}>
                    <TableCell className="font-mono text-sm text-terminal">#{a.block_number}</TableCell>
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
      </Tabs>
    </Layout>
  );
}
