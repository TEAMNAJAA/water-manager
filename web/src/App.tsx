import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { I18nProvider } from "./i18n";
import Bills from "./pages/Bills";
import Dashboard, { Network } from "./pages/Dashboard";
import Demo from "./pages/Demo";
import EvidenceReport from "./pages/EvidenceReport";
import Funds from "./pages/Funds";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Namjai from "./pages/Namjai";
import Points from "./pages/Points";
import ReadMeter from "./pages/ReadMeter";
import Repairs, { RepairDetail } from "./pages/Repairs";
import Report from "./pages/Report";
import Sms from "./pages/Sms";
import Story from "./pages/Story";
import Staff from "./pages/Staff";

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/read" element={<ReadMeter />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/report" element={<Report />} />
            <Route path="/repairs" element={<Repairs />} />
            <Route path="/repairs/:id" element={<RepairDetail />} />
            <Route path="/funds" element={<Funds />} />
            <Route path="/points" element={<Points />} />
            <Route path="/namjai" element={<Namjai />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/dashboard/:id" element={<Dashboard />} />
            <Route path="/network/:id" element={<Network />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/sms" element={<Sms />} />
            <Route path="/report/:id" element={<EvidenceReport />} />
            <Route path="/story/:id" element={<Story />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
