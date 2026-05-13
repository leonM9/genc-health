import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { WalletProvider, useWallet } from "@/lib/walletContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import Onboarding from "@/pages/Onboarding";
import AdminDashboard from "@/pages/AdminDashboard";
import PatientDashboard from "@/pages/PatientDashboard";
import DoctorDashboard from "@/pages/DoctorDashboard";
import AuthCallback from "@/pages/AuthCallback";
import VerifyCertificate from "@/pages/VerifyCertificate";

function RoleRoute() {
  const { session, loading } = useWallet();
  if (loading) return <BootLoader />;
  if (!session) return <Navigate to="/" replace />;
  if (session.role === "admin") return <Navigate to="/admin" replace />;
  if (session.role === "doctor") return <Navigate to="/doctor" replace />;
  if (session.role === "patient") return <Navigate to="/patient" replace />;
  return <Navigate to="/onboarding" replace />;
}

function Protected({ role, children }) {
  const { session, loading } = useWallet();
  if (loading) return <BootLoader />;
  if (!session) return <Navigate to="/" replace />;
  if (session.role !== role) return <Navigate to="/dashboard" replace />;
  return children;
}

function BootLoader() {
  return (
    <div className="min-h-screen bg-mesh flex items-center justify-center">
      <div className="text-emerald-400 font-mono text-sm tracking-widest animate-pulse">LOADING…</div>
    </div>
  );
}

function AppRouter() {
  const location = useLocation();
  // CRITICAL: detect OAuth callback synchronously before any other route
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/verify" element={<VerifyCertificate />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/dashboard" element={<RoleRoute />} />
      <Route path="/admin" element={<Protected role="admin"><AdminDashboard /></Protected>} />
      <Route path="/doctor" element={<Protected role="doctor"><DoctorDashboard /></Protected>} />
      <Route path="/patient" element={<Protected role="patient"><PatientDashboard /></Protected>} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <WalletProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
        <Toaster theme="dark" position="bottom-right" />
      </WalletProvider>
    </div>
  );
}

export default App;
