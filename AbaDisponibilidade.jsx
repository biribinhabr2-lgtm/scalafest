"use client";
import { avatarColor, initials } from "./utils";

export const Avatar = ({ nome, size = 36 }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: avatarColor(nome), display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color: "#fff", flexShrink: 0, letterSpacing: 0.5 }}>
    {initials(nome)}
  </div>
);

export const Badge = ({ label, color }) => (
  <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 6, fontSize: 11, fontWeight: 600, padding: "2px 8px", whiteSpace: "nowrap" }}>{label}</span>
);

export const StatusBadge = ({ status }) => {
  const map = { "Confirmado": "#10b981", "Em negociação": "#f59e0b", "Cancelado": "#ef4444" };
  return <Badge label={status} color={map[status] || "#6b7280"} />;
};

export const Card = ({ children, style, onClick }) => (
  <div onClick={onClick} style={{ background: "#1a1f2e", border: "1px solid #2a3047", borderRadius: 16, padding: 20, ...style }}>{children}</div>
);

export const Input = ({ label, ...props }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1 }}>{label}</label>}
    <input {...props} style={{ background: "#0f1320", border: "1px solid #2a3047", borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit", ...props.style }} />
  </div>
);

export const Select = ({ label, children, ...props }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1 }}>{label}</label>}
    <select {...props} style={{ background: "#0f1320", border: "1px solid #2a3047", borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit", ...props.style }}>{children}</select>
  </div>
);

export const Btn = ({ children, variant = "primary", small, ...props }) => {
  const v = {
    primary: { background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none" },
    ghost: { background: "transparent", color: "#8892b0", border: "1px solid #2a3047" },
    danger: { background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444" },
    success: { background: "#10b98122", color: "#10b981", border: "1px solid #10b98144" },
  };
  return (
    <button {...props} style={{ ...v[variant], borderRadius: 10, padding: small ? "6px 12px" : "10px 20px", fontSize: small ? 12 : 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", ...props.style }}>
      {children}
    </button>
  );
};

export const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#1a1f2e", border: "1px solid #2a3047", borderRadius: 20, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ color: "#e2e8f0", margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8892b0", cursor: "pointer", fontSize: 22 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const WaBtn = ({ url, tipo, small: sm }) => {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#25d36622", border: "1px solid #25d36644", borderRadius: 8, padding: sm ? "4px 8px" : "6px 12px", color: "#25d366", fontSize: sm ? 11 : 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: sm ? 13 : 15 }}>💬</span>
      {tipo === "escala" ? "Escala" : "Cobrança"}
    </a>
  );
};

export const Sidebar = ({ aba, setAba, mobile }) => {
  const NAV = [
    { id: "eventos", icon: "🎪", label: "Eventos" },
    { id: "equipe", icon: "👥", label: "Equipe" },
    { id: "disponibilidade", icon: "📅", label: "Disponibilidade" },
    { id: "relatorios", icon: "💰", label: "Relatórios" },
  ];
  return (
    <nav style={{ width: mobile ? "100%" : 220, background: "#0f1320", borderRight: mobile ? "none" : "1px solid #1e2540", borderTop: mobile ? "1px solid #1e2540" : "none", display: "flex", flexDirection: mobile ? "row" : "column", padding: mobile ? "8px 0" : "24px 0", flexShrink: 0, justifyContent: mobile ? "space-around" : "flex-start" }}>
      {!mobile && (
        <div style={{ padding: "0 20px 28px" }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: "#e2e8f0" }}><span style={{ color: "#8b5cf6" }}>Scala</span>Fest</div>
          <div style={{ fontSize: 11, color: "#4a5568", marginTop: 2 }}>Gestão de Eventos</div>
        </div>
      )}
      {NAV.map(n => (
        <button key={n.id} onClick={() => setAba(n.id)} style={{ display: "flex", flexDirection: mobile ? "column" : "row", alignItems: "center", gap: mobile ? 4 : 12, padding: mobile ? "6px 12px" : "12px 20px", background: aba === n.id ? "#8b5cf611" : "transparent", borderLeft: !mobile && aba === n.id ? "3px solid #8b5cf6" : "3px solid transparent", border: mobile ? "none" : undefined, color: aba === n.id ? "#8b5cf6" : "#6b7280", fontWeight: 600, fontSize: mobile ? 10 : 14, cursor: "pointer", width: mobile ? "auto" : "100%", textAlign: mobile ? "center" : "left", fontFamily: "inherit" }}>
          <span style={{ fontSize: mobile ? 20 : 18 }}>{n.icon}</span>
          {n.label}
        </button>
      ))}
    </nav>
  );
};
