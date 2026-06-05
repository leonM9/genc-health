import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { api } from "@/lib/api";

const WalletCtx = createContext(null);
const STORAGE = "genc.session";
const PK_STORAGE = "genc.demo.pk";

export function WalletProvider({ children }) {
  const [session, setSession] = useState(null);
  const [adminInfo, setAdminInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Boot: try Google session first, then localStorage wallet
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Skip /auth/me if we're handling an OAuth callback (hash contains session_id)
        if (!window.location.hash?.includes("session_id=")) {
          const r = await api.get("/auth/me").catch(() => null);
          if (r && r.data && !cancelled) {
            const w = new ethers.Wallet(r.data.wallet.private_key);
            const s = {
              address: r.data.wallet.address,
              role: r.data.role,
              profile: r.data.profile,
              wallet: w,
              auth: "google",
              email: r.data.email,
              name: r.data.name,
              picture: r.data.picture,
              demo: false,
            };
            setSession(s);
            setLoading(false);
            api.get("/admin/info").then((x) => !cancelled && setAdminInfo(x.data)).catch(() => {});
            return;
          }
        }
        // Wallet-based session restore
        const raw = localStorage.getItem(STORAGE);
        if (raw) {
          const s = JSON.parse(raw);
          const pk = localStorage.getItem(PK_STORAGE);
          if (s.demo && pk) s.wallet = new ethers.Wallet(pk);
          if (!cancelled) setSession(s);
        }
      } finally {
        if (!cancelled) setLoading(false);
        api.get("/admin/info").then((r) => !cancelled && setAdminInfo(r.data)).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistLocal = (s) => {
    const clean = { ...s };
    delete clean.wallet;
    localStorage.setItem(STORAGE, JSON.stringify(clean));
  };

  const signMessage = useCallback(async (message) => {
    if (!session) throw new Error("No session");
    if (session.wallet) return await session.wallet.signMessage(message);
    if (!session.demo && window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      return await signer.signMessage(message);
    }
    throw new Error("No signing capability");
  }, [session]);

  const buildSig = useCallback(async (purpose) => {
    const message = `Gen C ${purpose} :: ${new Date().toISOString()} :: ${Math.random().toString(36).slice(2)}`;
    const signature = await signMessage(message);
    return { message, signature };
  }, [signMessage]);

  const loginDemo = async () => {
    setLoading(true);
    try {
      // Reuse existing in-browser pk if present so re-login keeps identity
      const existingPk = localStorage.getItem(PK_STORAGE);
      const wallet = existingPk ? new ethers.Wallet(existingPk) : ethers.Wallet.createRandom();
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const r = await api.post("/auth/verify", { address: wallet.address, message, signature });
      const s = { ...r.data, demo: true, wallet, auth: "demo" };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persistLocal(s);
      setSession(s);
      return s;
    } finally { setLoading(false); }
  };

  const loginAsAdmin = async () => {
    setLoading(true);
    try {
      if (!adminInfo) throw new Error("Admin info not loaded");
      const wallet = new ethers.Wallet(adminInfo.private_key);
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const r = await api.post("/auth/verify", { address: wallet.address, message, signature });
      const s = { ...r.data, demo: true, wallet, auth: "admin" };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persistLocal(s);
      setSession(s);
      return s;
    } finally { setLoading(false); }
  };

  const loginWithPrivateKey = async (pk) => {
    setLoading(true);
    try {
      const wallet = new ethers.Wallet(pk);
      const message = `Sign-In with Ethereum :: Gen C :: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const r = await api.post("/auth/verify", { address: wallet.address, message, signature });
      const s = { ...r.data, demo: true, wallet, auth: "demo" };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persistLocal(s);
      setSession(s);
      return s;
    } finally { setLoading(false); }
  };

  // NEW · Username + password login. The private key is fetched from the server
  // ONLY after password verification and never appears in the URL/UI on login.
  const loginWithCredentials = async (username, password) => {
    setLoading(true);
    try {
      const r = await api.post("/auth/credentials/login", { username, password });
      const wallet = new ethers.Wallet(r.data.wallet_private_key);
      const s = {
        address: r.data.address,
        role: r.data.role,
        profile: r.data.profile,
        wallet,
        auth: "credentials",
        username: r.data.username,
        demo: true,
      };
      localStorage.setItem(PK_STORAGE, wallet.privateKey);
      persistLocal(s);
      setSession(s);
      return s;
    } finally { setLoading(false); }
  };

  // Bind a username + password to the current wallet (used during onboarding).
  const registerCredentials = async (username, password) => {
    if (!session?.wallet) throw new Error("No wallet in session");
    const message = `Gen C credentials-register :: ${new Date().toISOString()}`;
    const signature = await session.wallet.signMessage(message);
    const r = await api.post("/auth/credentials/register", {
      wallet_address: session.address,
      wallet_private_key: session.wallet.privateKey,
      wallet_signature: signature,
      wallet_message: message,
      username,
      password,
    });
    // Stash username so the dashboard's export-key flow knows who's logged in
    const updated = { ...session, username: r.data.username, auth: "credentials" };
    persistLocal(updated);
    setSession(updated);
    return r.data;
  };

  // Export the wallet private key after the user re-confirms their password.
  const exportPrivateKey = async (password) => {
    const uname = session?.username;
    if (!uname) throw new Error("No credentials bound to this session yet");
    const r = await api.post("/auth/credentials/export-key", { username: uname, password });
    return r.data;
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
      const s = { ...r.data, demo: false, auth: "metamask" };
      persistLocal(s);
      setSession(s);
      return s;
    } finally { setLoading(false); }
  };

  // Called by AuthCallback after Google OAuth completes
  const exchangeGoogleSession = async (sessionId) => {
    setLoading(true);
    try {
      const r = await api.post("/auth/google/session", { session_id: sessionId });
      const wallet = new ethers.Wallet(r.data.wallet.private_key);
      const s = {
        address: r.data.wallet.address,
        role: r.data.role,
        profile: r.data.profile,
        wallet,
        auth: "google",
        email: r.data.email,
        name: r.data.name,
        picture: r.data.picture,
        demo: false,
      };
      setSession(s);
      return s;
    } finally { setLoading(false); }
  };

  const logout = async () => {
    try {
      if (session?.auth === "google") await api.post("/auth/logout");
    } catch {}
    localStorage.removeItem(STORAGE);
    localStorage.removeItem(PK_STORAGE);
    setSession(null);
  };

  const refresh = async () => {
    if (!session) return;
    const r = await api.get(`/users/${session.address}`).catch(() => null);
    if (r) {
      const updated = { ...session, profile: r.data, role: r.data.role || session.role };
      if (session.auth !== "google") persistLocal(updated);
      setSession(updated);
    }
  };

  return (
    <WalletCtx.Provider
      value={{
        session, adminInfo, loading,
        loginDemo, loginAsAdmin, loginWithPrivateKey, loginMetaMask,
        loginWithCredentials, registerCredentials, exportPrivateKey,
        exchangeGoogleSession,
        logout, signMessage, buildSig, refresh,
      }}
    >
      {children}
    </WalletCtx.Provider>
  );
}

export function useWallet() { return useContext(WalletCtx); }
