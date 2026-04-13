"use client";
import { useState } from "react";
import { CORES_FUNCAO } from "./data";
import { fmtDate, waEscala, waPagamento, limparTel } from "./utils";
import { Avatar, Badge, Card, Input, Select, Btn, Modal, WaBtn } from "./UI";

export default function AbaRelatorios({ eventos, setEventos, freelancers }) {
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroPessoa, setFiltroPessoa] = useState("");
  const [filtroMes, setFiltroMes] = useState("");
  const [waModal, setWaModal] = useState(false);

  const fl = id => freelancers.find(f => f.id === id);

  const todos = eventos.flatMap(ev =>
    ev.equipe.map((m, idx) => ({
      eventoId: ev.id, eventoNome: ev.nome, data: ev.data,
      local: ev.local, horaInicio: ev.horaInicio, horaFim: ev.horaFim,
      freelancer: fl(m.freelancerId), funcao: m.funcao,
      cache: m.cache, pago: m.pago, idx
    }))
  ).filter(r => r.freelancer);

  const filtrado = todos.filter(r => {
    if (filtroStatus === "pago" && !r.pago) return false;
    if (filtroStatus === "pendente" && r.pago) return false;
    if (filtroPessoa && r.freelancer?.id !== +filtroPessoa) return false;
    if (filtroMes && !r.data.startsWith(filtroMes)) return false;
    return true;
  });

  const totalPendente = filtrado.filter(r => !r.pago).reduce((s, r) => s + r.cache, 0);
  const totalPago = filtrado.filter(r => r.pago).reduce((s, r) => s + r.cache, 0);
  const totalGeral = filtrado.reduce((s, r) => s + r.cache, 0);

  const togglePago = (eventoId, idx) => setEventos(ev => ev.map(e => e.id === eventoId ? { ...e, equipe: e.equipe.map((m, i) => i === idx ? { ...m, pago: !m.pago } : m) } : e));
  const marcarTodosPagos = () => filtrado.filter(r => !r.pago).forEach(r => togglePago(r.eventoId, r.idx));

  return (
    <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 22 }}>💰 Relatórios & Cachês</h2>
          <p style={{ color: "#6b7280", margin: "4px 0 0", fontSize: 13 }}>Controle de pagamentos</p>
        </div>
      </div>

      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Total Geral", valor: totalGeral, cor: "#8b5cf6", icon: "💼" },
          { label: "Pago", valor: totalPago, cor: "#10b981", icon: "✅" },
          { label: "Pendente", valor: totalPendente, cor: "#f59e0b", icon: "🔴" },
          { label: "Registros", valor: null, count: filtrado.length, cor: "#3b82f6", icon: "📋" },
        ].map(c => (
          <Card key={c.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 26, marginBottom: 4 }}>{c.icon}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.cor }}>{c.valor !== null ? `R$ ${c.valor.toFixed(2).replace(".", ",")}` : c.count}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{c.label}</div>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 130px" }}>
            <Select label="Status" value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
              <option value="todos">Todos</option>
              <option value="pendente">Pendentes</option>
              <option value="pago">Pagos</option>
            </Select>
          </div>
          <div style={{ flex: "1 1 170px" }}>
            <Select label="Freelancer" value={filtroPessoa} onChange={e => setFiltroPessoa(e.target.value)}>
              <option value="">Todos</option>
              {freelancers.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </Select>
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <Input label="Mês (AAAA-MM)" value={filtroMes} onChange={e => setFiltroMes(e.target.value)} placeholder="2026-04" />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {filtrado.some(r => !r.pago) && <Btn variant="success" onClick={marcarTodosPagos}>✅ Marcar Todos Pagos</Btn>}
            {filtrado.some(r => !r.pago && r.freelancer?.telefone) && (
              <Btn onClick={() => setWaModal(true)} style={{ background: "#25d36622", border: "1px solid #25d36644", color: "#25d366" }}>💬 Cobrar via WhatsApp</Btn>
            )}
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0f1320" }}>
                {["Freelancer","Evento","Data","Função","Cachê","Status","Pag.","WhatsApp"].map(h => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#4a5568", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 && <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "#4a5568" }}>Nenhum registro</td></tr>}
              {filtrado.map((r, i) => {
                const ev = { id: r.eventoId, nome: r.eventoNome, data: r.data, local: r.local, horaInicio: r.horaInicio, horaFim: r.horaFim };
                const m = { funcao: r.funcao, cache: r.cache };
                return (
                  <tr key={i} style={{ borderTop: "1px solid #1e2540", background: i % 2 === 0 ? "transparent" : "#ffffff04" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar nome={r.freelancer.nome} size={28} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{r.freelancer.nome}</div>
                          {r.freelancer.telefone && <div style={{ fontSize: 10, color: "#4a5568" }}>{r.freelancer.telefone}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#8892b0", maxWidth: 160 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.eventoNome}</div></td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#8892b0", whiteSpace: "nowrap" }}>{fmtDate(r.data)}</td>
                    <td style={{ padding: "10px 14px" }}><Badge label={r.funcao} color={CORES_FUNCAO[r.funcao] || "#6b7280"} /></td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#e2e8f0", whiteSpace: "nowrap" }}>R$ {r.cache.toFixed(2).replace(".", ",")}</td>
                    <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, fontWeight: 700, color: r.pago ? "#10b981" : "#f59e0b" }}>{r.pago ? "✅ Pago" : "🔴 Pendente"}</span></td>
                    <td style={{ padding: "10px 14px" }}><Btn small variant={r.pago ? "ghost" : "success"} onClick={() => togglePago(r.eventoId, r.idx)}>{r.pago ? "Desfazer" : "Pago ✓"}</Btn></td>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <WaBtn url={waEscala(r.freelancer, ev, m)} tipo="escala" small />
                        {!r.pago && <WaBtn url={waPagamento(r.freelancer, ev, m)} tipo="pagamento" small />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtrado.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid #2a3047", background: "#0f1320" }}>
                  <td colSpan={4} style={{ padding: "10px 14px", fontSize: 11, color: "#6b7280" }}>{filtrado.length} registros</td>
                  <td style={{ padding: "10px 14px", fontWeight: 800, color: "#e2e8f0" }}>R$ {totalGeral.toFixed(2).replace(".", ",")}</td>
                  <td colSpan={3} style={{ padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: "#10b981" }}>✅ R$ {totalPago.toFixed(2).replace(".", ",")}</div>
                    <div style={{ fontSize: 11, color: "#f59e0b" }}>🔴 R$ {totalPendente.toFixed(2).replace(".", ",")}</div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Modal WhatsApp em massa */}
      <Modal open={waModal} onClose={() => setWaModal(false)} title="💬 Cobrar Pendentes via WhatsApp">
        {(() => {
          const pendentes = filtrado.filter(r => !r.pago && r.freelancer?.telefone);
          const porFreelancer = {};
          pendentes.forEach(r => {
            const fid = r.freelancer.id;
            if (!porFreelancer[fid]) porFreelancer[fid] = { freelancer: r.freelancer, items: [] };
            porFreelancer[fid].items.push(r);
          });
          const grupos = Object.values(porFreelancer);
          if (!grupos.length) return <div style={{ color: "#6b7280", fontSize: 13 }}>Nenhum pendente com telefone cadastrado.</div>;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: "#25d36615", border: "1px solid #25d36630", borderRadius: 10, padding: 10, fontSize: 12, color: "#25d366" }}>
                💬 Clique para abrir o WhatsApp com a cobrança consolidada de cada freelancer.
              </div>
              {grupos.map(({ freelancer: f, items }) => {
                const totalF = items.reduce((s, r) => s + r.cache, 0);
                const listaItens = items.map(r => `• ${r.eventoNome} (${fmtDate(r.data)}) — R$ ${r.cache.toFixed(2).replace(".",",")} [${r.funcao}]`).join("\n");
                const msg = `Olá, *${f.nome}*! 👋\n\nCachês pendentes:\n\n${listaItens}\n\n💰 *Total: R$ ${totalF.toFixed(2).replace(".",",")}*${f.pix ? `\n\n💳 PIX: *${f.pix}*` : ""}\n\nObrigado! 🙏`;
                const tel = limparTel(f.telefone);
                const url = `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
                return (
                  <div key={f.id} style={{ background: "#0f1320", borderRadius: 10, padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Avatar nome={f.nome} size={38} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>{f.nome}</div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{items.length} evento(s) · <span style={{ color: "#f59e0b", fontWeight: 700 }}>R$ {totalF.toFixed(2).replace(".",",")}</span></div>
                    </div>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg,#25d366,#128c7e)", borderRadius: 10, padding: "9px 16px", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none", fontFamily: "inherit" }}>
                      💬 Enviar
                    </a>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
