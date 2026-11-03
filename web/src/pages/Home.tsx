import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Layout, Loading } from "../components/Layout";
import { StatusCard, type VillageStatus } from "../components/Status";
import { useApi } from "../hooks";
import { useT } from "../i18n";

export default function Home() {
  const { me, loading, staff, logout } = useAuth();
  const { t } = useT();
  const { data: s, error } = useApi<VillageStatus>(me?.village_id ? `/api/villages/${me.village_id}/status` : null, [me?.village_id]);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  const tiles = [
    { to: "/read", icon: "📷", label: me.meter || staff ? "Read my meter" : "Read a meter", show: true },
    { to: "/bills", icon: "🧾", label: "My bills", badge: me.unpaid, show: !!me.meter_id },
    { to: "/repairs", icon: "🔧", label: "Repairs", show: true },
    { to: "/funds", icon: "💰", label: "Village funds", show: true },
    { to: "/points", icon: "⭐", label: "Points", show: true },
    { to: "/namjai", icon: "💚", label: "Namjai", show: true },
    { to: `/dashboard/${me.village_id ?? ""}`, icon: "📊", label: "Dashboard", show: !!me.village_id },
    { to: "/staff", icon: "🧰", label: "Caretaker tools", show: staff },
  ].filter((x) => x.show);
  return (
    <Layout title={s?.name ?? "NamJai"} back={false}>
      {s ? <StatusCard s={s} /> : <Loading error={error} />}
      {s?.simulated && <p className="center"><span className="sim-tag">{t("Simulated data")}</span></p>}
      <Link to="/report" className="btn danger block report-btn">⚠️ {t("Report a problem")}</Link>
      <div className="grid" style={{ marginTop: 12 }}>
        {tiles.map((x) => (
          <Link key={x.to} to={x.to} className="tile">
            <span className="icon" aria-hidden>{x.icon}</span>
            {t(x.label)}
            {!!x.badge && <span className="badge">{x.badge}</span>}
          </Link>
        ))}
      </div>
      <div className="row between small muted" style={{ marginTop: 20 }}>
        <span>{me.name} · {t(me.role[0].toUpperCase() + me.role.slice(1))} · ⭐ {me.points}</span>
        <button className="btn small" onClick={logout}>{t("Log out")}</button>
      </div>
    </Layout>
  );
}
