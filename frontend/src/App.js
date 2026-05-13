import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { WalletProvider, useWallet } from "@/lib/walletContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";
import PatientDashboard from "@/pages/PatientDashboard";
import DoctorDashboard from "@/pages/DoctorDashboard";

function RoleRoute() {
  const { session } = useWallet();
  if (!session) return <Navigate to="/" replace />;
  if (session.role === "admin") return <Navigate to="/admin" replace />;
  if (session.role === "doctor") return <Navigate to="/doctor" replace />;
  if (session.role === "patient") return <Navigate to="/patient" replace />;
  return <Navigate to="/" replace />;
}

function Protected({ role, children }) {
  const { session } = useWallet();
  if (!session) return <Navigate to="/" replace />;
  if (session.role !== role) return <Navigate to="/dashboard" replace />;
  return children;
}

function App() {
  return (
    <div className="App scanlines">
      <WalletProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/dashboard" element={<RoleRoute />} />
            <Route path="/admin" element={<Protected role="admin"><AdminDashboard /></Protected>} />
            <Route path="/doctor" element={<Protected role="doctor"><DoctorDashboard /></Protected>} />
            <Route path="/patient" element={<Protected role="patient"><PatientDashboard /></Protected>} />
          </Routes>
        </BrowserRouter>
        <Toaster theme="dark" position="bottom-right" />
      </WalletProvider>
    </div>
  );
}

export default App;
