import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { api } from "@/lib/api";

const WalletCtx = createContext(null);

const STORAGE = "genc.session";
const PK_STORAGE = "genc.demo.pk";

export function WalletProvider({ children }) {
  const [session, setSession] = useState(null); // {address, role, profile, wallet, demo}
  const [adminInfo, setAdminInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const s = JSON.parse(raw);
        const pk = localStorage.getItem(PK_STORAGE);
        if (s.demo && pk) {
          s.wallet = new ethers.Wallet(pk);
        }
        setSession(s);
      }
    } catch (e) {
      console.warn("session restore failed", e);
    }
    api.get("/admin/info").then((r) => setAdminInfo(r.data)).catch(() => {});
  }, []);

  const persist = (s) => {
    const clean = { ...s };
    delete clean.wallet;
    localStorage.setItem(STORAGE, JSON.stringify(clean));
  };

  const signMessage = useCallback(async (message) => {
    if (!session) throw new Error("No session");
    if (session.demo) {
      return await session.wallet.signMessage(message);
    }
    // MetaMask path
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    return await signer.signMessage(message);
  }, [session]);

  const buildSig = useCallback(async (purpose) => {
    const message = `Gen C ${purpose} :: ${new Date().toISOString()} :: ${Math.random().toString(36).slice(2)}`;
    const signature = await signMessage(message);
    return { message, signature };
  }, [signMessage]);

  const loginDemo = async () => {
    setLoading(true);
    try {
      const wallet = ethers.Wallet.createRandom();
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const r = await api.post("/auth/verify", { address: wallet.address, message, signature });
      const s = { ...r.data, demo: true, wallet };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persist(s);
      setSession(s);
      return s;
    } finally {
      setLoading(false);
    }
  };

  const loginAsAdmin = async () => {
    setLoading(true);
    try {
      if (!adminInfo) throw new Error("Admin info not loaded");
      const wallet = new ethers.Wallet(adminInfo.private_key);
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const r = await api.post("/auth/verify", { address: wallet.address, message, signature });
      const s = { ...r.data, demo: true, wallet };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persist(s);
      setSession(s);
      return s;
    } finally {
      setLoading(false);
    }
  };

  const loginWithPrivateKey = async (pk) => {
    setLoading(true);
    try {
      const wallet = new ethers.Wallet(pk);
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const r = await api.post("/auth/verify", { address: wallet.address, message, signature });
      const s = { ...r.data, demo: true, wallet };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persist(s);
      setSession(s);
      return s;
    } finally {
      setLoading(false);
    }
  };

  const loginMetaMask = async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await signer.signMessage(message);
      const r = await api.post("/auth/verify", { address, message, signature });
      const s = { ...r.data, demo: false };
      persist(s);
      setSession(s);
      return s;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(STORAGE);
    localStorage.removeItem(PK_STORAGE);
    setSession(null);
  };

  const refresh = async () => {
    if (!session) return;
    const r = await api.get(`/users/${session.address}`).catch(() => null);
    if (r) {
      const updated = { ...session, profile: r.data, role: r.data.role || session.role };
      persist(updated);
      setSession(updated);
    }
  };

  return (
    <WalletCtx.Provider
      value={{ session, adminInfo, loading, loginDemo, loginAsAdmin, loginWithPrivateKey, loginMetaMask, logout, signMessage, buildSig, refresh }}
    >
      {children}
    </WalletCtx.Provider>
  );
}

export function useWallet() {
  return useContext(WalletCtx);
}
