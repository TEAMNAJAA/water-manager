import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Layout, Loading } from "../components/Layout";
import { StatusCard, type VillageStatus } from "../components/Status";
import { VillageChat } from "../components/VillageChat";
import { useApi } from "../hooks";
import { useEffect } from "react";
import { useT } from "../i18n";

export default function Home() {
  const { me, loading, staff, logout } = useAuth();
  const { t } = useT();
  const { data: s, error, reload } = useApi<VillageStatus>(me?.village_id ? `/api/villages/${me.village_id}/status` : null, [me?.village_id]);
  useEffect(() => {
    const i = setInterval(reload, 30000);
    return () => clearInterval(i);
  }, [reload]);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.role === "technician")
    return (
      <Layout title={`👷 ${me.name}`} back={false}>
        <p className="muted" style={{ marginTop: 16 }}>{t("You work for every village in the network.")}</p>
        <div className="grid" style={{ marginTop: 12 }}>
          <Link to="/repairs" className="tile"><span className="icon">🔧</span>{t("Repairs")}</Link>
          {me.network_id && <Link to={`/network/${me.network_id}`} className="tile"><span className="icon">🤝</span>{t("District network")}</Link>}
        </div>
        <div className="row between small muted" style={{ marginTop: 20 }}>
          <span>{me.name} · {t("Technician")}</span>
          <button className="btn small" onClick={logout}>{t("Log out")}</button>
        </div>
      </Layout>
    );
  const tiles = [
    { to: me.village_id ? `/?v=${me.village_id}` : "/", icon: "🗺️", label: "3D village map", main: true },
    { to: "/read", icon: "📷", label: me.meter || staff ? "Read my meter" : "Read a meter", main: true },
    { to: "/repairs", icon: "🔧", label: "Repairs", main: true },
    { to: "/staff", icon: "🧰", label: "Caretaker tools", main: staff, hide: !staff },
    { to: "/bills", icon: "🧾", label: "My bills", badge: me.unpaid, main: me.unpaid > 0, hide: !me.meter_id },
    { to: `/story/${me.village_id ?? ""}`, icon: "🎬", label: "Leak story", main: false, hide: !me.village_id },
    { to: `/dashboard/${me.village_id ?? ""}`, icon: "📊", label: "Dashboard", main: false, hide: !me.village_id },
    { to: "/funds", icon: "💰", label: "Village funds", main: false },
    { to: "/points", icon: "⭐", label: "Points", main: false },
    { to: "/namjai", icon: "💚", label: "Namjai", main: false },
  ].filter((x) => !x.hide);
  const tile = (x: (typeof tiles)[number]) => (
    <Link key={x.to} to={x.to} className="tile">
      <span className="icon" aria-hidden>{x.icon}</span>
      {t(x.label)}
      {!!x.badge && <span className="badge">{x.badge}</span>}
    </Link>
  );
  return (
    <Layout title={s?.name ?? "NamJai"} back={false}>
      {s ? <StatusCard s={s} /> : <Loading error={error} />}
      {s?.simulated && <p className="center"><span className="sim-tag">{t("Simulated data")}</span></p>}
      <Link to="/report" className="btn danger block report-btn">⚠️ {t("Report a problem")}</Link>
      <div className="grid" style={{ marginTop: 12 }}>{tiles.filter((x) => x.main).map(tile)}</div>
      <details className="more" style={{ marginTop: 12 }}>
        <summary className="btn block">➕ {t("More")}</summary>
        <div className="grid" style={{ marginTop: 12 }}>{tiles.filter((x) => !x.main).map(tile)}</div>
      </details>
      {me.village_id && <VillageChat villageId={me.village_id} />}
      <div className="row between small muted" style={{ marginTop: 20 }}>
        <span>{me.name} · {t(me.role[0].toUpperCase() + me.role.slice(1))} · ⭐ {me.points}</span>
        <button className="btn small" onClick={logout}>{t("Log out")}</button>
      </div>
    </Layout>
  );
}
