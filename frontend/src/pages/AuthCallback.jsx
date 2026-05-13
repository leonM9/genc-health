import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@/lib/walletContext";
import { toast } from "sonner";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const nav = useNavigate();
  const { exchangeGoogleSession } = useWallet();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const hash = window.location.hash || "";
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      toast.error("Missing OAuth session_id");
      nav("/", { replace: true });
      return;
    }
    (async () => {
      try {
        const s = await exchangeGoogleSession(sessionId);
        // Clean URL
        window.history.replaceState(null, "", window.location.pathname);
        toast.success(`Welcome, ${s.name || s.email}`);
        if (s.role === "unregistered") nav("/onboarding", { replace: true });
        else nav("/dashboard", { replace: true });
      } catch (e) {
        toast.error("Google sign-in failed", { description: e?.response?.data?.detail || e.message });
        nav("/", { replace: true });
      }
    })();
  }, [exchangeGoogleSession, nav]);

  return (
    <div className="min-h-screen bg-mesh flex items-center justify-center">
      <div className="card-modern px-8 py-6 text-center">
        <div className="font-mono text-xs eyebrow mb-2">authenticating</div>
        <div className="text-sky-400 font-mono text-sm animate-pulse">verifying google identity…</div>
      </div>
    </div>
  );
}
