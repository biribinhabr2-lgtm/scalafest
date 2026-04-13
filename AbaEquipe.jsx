"use client";
import { useState } from "react";
import { Avatar, Card } from "./UI";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DISP_CORES = { disponivel: "#10b981", indisponivel: "#ef4444", parcial: "#f59e0b" };
const DISP_LABELS = { disponivel: "Disponível", indisponivel: "Indisponível", parcial: "Parcial" };

export default function AbaDisponibilidade({ freelancers, disponibilidade, setDisponibilidade }) {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth());
  const [ano, setAno] = useState(hoje.getFullYear());
  const [selecionado, setSelecionado] = useState(freelancers[0]?.id);
  const [busca, setBusca] = useState("");

  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const disp = disponibilidade[selecionado] || {};

  const toggleDia = (dia) => {
    const k = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const ciclo = ["disponivel", "parcial", "indisponivel", undefined];
    const idx = ciclo.indexOf(disp[k]);
    const prox = ciclo[(idx + 1) % ciclo.length];
    setDisponibilidade(d => ({ ...d, [selecionado]: { ...(d[selecionado] || {}), [k]: prox } }));
  };

  const filtrados = freelancers.filter(f => f.nome.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
      <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 22 }}>📅 Disponibilidade</h2>
      <p style={{ color: "#6b7280", margin: "0 0 20px", fontSize: 13 }}>Clique em um dia para ciclar: Disponível → Parcial → Indisponível</p>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 20 }}>
        <div>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Filtrar..." style={{ background: "#1a1f2e", border: "1px solid #2a3047", borderRadius: 10, padding: "8px 12px", color: "#e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit", width: "100%", marginBottom: 8, boxSizing: "border-box" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {filtrados.map(f => {
              const dispF = disponibilidade[f.id] || {};
              const n = Object.values(dispF).filter(v => v === "disponivel").length;
              return (
                <button key={f.id} onClick={() => setSelecionado(f.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", background: selecionado === f.id ? "#8b5cf611" : "#1a1f2e", border: `1px solid ${selecionado === f.id ? "#8b5cf6" : "#2a3047"}`, borderRadius: 10, cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}>
                  <Avatar nome={f.nome} size={28} />
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.nome}</div>
                    <div style={{ fontSize: 10, color: "#10b981" }}>{n} dias livres</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button onClick={() => { if (mes === 0) { setMes(11); setAno(a => a - 1); } else setMes(m => m - 1); }} style={{ background: "none", border: "none", color: "#8892b0", cursor: "pointer", fontSize: 22 }}>‹</button>
            <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 15 }}>{MESES[mes]} {ano} — {freelancers.find(f => f.id === selecionado)?.nome}</div>
            <button onClick={() => { if (mes === 11) { setMes(0); setAno(a => a + 1); } else setMes(m => m + 1); }} style={{ background: "none", border: "none", color: "#8892b0", cursor: "pointer", fontSize: 22 }}>›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 6 }}>
            {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "#4a5568", fontWeight: 700, padding: "3px 0" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {Array.from({ length: primeiroDia }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: diasNoMes }).map((_, i) => {
              const dia = i + 1;
              const k = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
              const estado = disp[k];
              const cor = DISP_CORES[estado];
              return (
                <button key={dia} onClick={() => toggleDia(dia)} style={{ background: cor ? cor + "22" : "#0f1320", border: `1px solid ${cor ? cor + "55" : "#2a3047"}`, borderRadius: 7, padding: "7px 2px", color: cor || "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>{dia}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
            {Object.entries(DISP_LABELS).map(([k, l]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8892b0" }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: DISP_CORES[k] }} />{l}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8892b0" }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: "#0f1320", border: "1px solid #2a3047" }} />Não informado
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
