"use client";
import { useState } from "react";
import { FUNCOES, CORES_FUNCAO } from "./data";
import { fmtDate, buildGoogleCalendarUrl, downloadICS, waEscala, waPagamento } from "./utils";
import { Avatar, Badge, StatusBadge, Card, Input, Select, Btn, Modal, WaBtn } from "./UI";

export default function AbaEventos({ eventos, setEventos, freelancers, disponibilidade }) {
  const [modal, setModal] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [form, setForm] = useState({});
  const [membroForm, setMembroForm] = useState({ freelancerId: "", funcao: "Líder", cache: "" });
  const [filtro, setFiltro] = useState("");
  const [gcalModal, setGcalModal] = useState(null);
  const [alertaConflito, setAlertaConflito] = useState(null);

  const verificarDisponibilidade = (freelancerId, evento) => {
    if (!freelancerId || !evento?.data) return null;
    const disp = disponibilidade[freelancerId] || {};
    const status = disp[evento.data];
    const conflitoEvento = eventos.find(ev => ev.id !== evento.id && ev.data === evento.data && ev.equipe.find(m => m.freelancerId === +freelancerId));
    if (conflitoEvento) return { tipo: "conflito", msg: `Já escalado em "${conflitoEvento.nome}"`, cor: "#ef4444" };
    if (status === "indisponivel") return { tipo: "indisponivel", msg: "Indisponível neste dia", cor: "#ef4444" };
    if (status === "parcial") return { tipo: "parcial", msg: "Disponibilidade parcial", cor: "#f59e0b" };
    if (status === "disponivel") return { tipo: "disponivel", msg: "Disponível ✓", cor: "#10b981" };
    return { tipo: "sem_info", msg: "Disponibilidade não informada", cor: "#6b7280" };
  };

  const salvarEvento = () => {
    if (!form.nome || !form.data) return;
    if (form.id) setEventos(ev => ev.map(e => e.id === form.id ? { ...e, ...form } : e));
    else setEventos(ev => [...ev, { ...form, id: Date.now(), equipe: [] }]);
    setModal(null);
  };

  const adicionarMembro = (eventoId) => {
    if (!membroForm.freelancerId) return;
    const evento = eventos.find(e => e.id === eventoId);
    const alerta = verificarDisponibilidade(membroForm.freelancerId, evento);
    if (alerta && (alerta.tipo === "indisponivel" || alerta.tipo === "conflito")) {
      const f = freelancers.find(x => x.id === +membroForm.freelancerId);
      setAlertaConflito({ ...alerta, freelancerNome: f?.nome, onConfirmar: () => {
        setEventos(ev => ev.map(e => e.id === eventoId ? { ...e, equipe: [...e.equipe, { freelancerId: +membroForm.freelancerId, funcao: membroForm.funcao, cache: +membroForm.cache || 0, pago: false }] } : e));
        setMembroForm({ freelancerId: "", funcao: "Líder", cache: "" });
        setAlertaConflito(null);
      }});
      return;
    }
    setEventos(ev => ev.map(e => e.id === eventoId ? { ...e, equipe: [...e.equipe, { freelancerId: +membroForm.freelancerId, funcao: membroForm.funcao, cache: +membroForm.cache || 0, pago: false }] } : e));
    setMembroForm({ freelancerId: "", funcao: "Líder", cache: "" });
  };

  const togglePago = (eventoId, idx) => setEventos(ev => ev.map(e => e.id === eventoId ? { ...e, equipe: e.equipe.map((m, i) => i === idx ? { ...m, pago: !m.pago } : m) } : e));
  const removerMembro = (eventoId, idx) => setEventos(ev => ev.map(e => e.id === eventoId ? { ...e, equipe: e.equipe.filter((_, i) => i !== idx) } : e));

  const eventosFiltrados = eventos.filter(e => e.nome.toLowerCase().includes(filtro.toLowerCase()) || e.tipo.toLowerCase().includes(filtro.toLowerCase()));
  const det = detalhe ? eventos.find(e => e.id === detalhe) : null;
  const fl = id => freelancers.find(f => f.id === id);

  return (
    <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 22 }}>🎪 Eventos</h2>
          <p style={{ color: "#6b7280", margin: "4px 0 0", fontSize: 13 }}>{eventos.length} eventos cadastrados</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="🔍 Buscar..." style={{ background: "#1a1f2e", border: "1px solid #2a3047", borderRadius: 10, padding: "8px 14px", color: "#e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
          <Btn onClick={() => { setForm({ nome: "", tipo: "Aniversário Infantil", data: "", horaInicio: "", horaFim: "", local: "", status: "Confirmado", obs: "" }); setModal("novo"); }}>＋ Novo Evento</Btn>
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {eventosFiltrados.map(ev => {
          const total = ev.equipe.reduce((s, m) => s + m.cache, 0);
          const pendente = ev.equipe.filter(m => !m.pago).reduce((s, m) => s + m.cache, 0);
          const ativo = detalhe === ev.id;
          return (
            <Card key={ev.id} onClick={() => { setDetalhe(ativo ? null : ev.id); setMembroForm({ freelancerId: "", funcao: "Líder", cache: "" }); }}
              style={{ cursor: "pointer", borderColor: ativo ? "#8b5cf6" : "#2a3047", boxShadow: ativo ? "0 0 0 2px #8b5cf644" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 15, marginBottom: 4 }}>{ev.nome}</div>
                  <div style={{ fontSize: 12, color: "#8892b0" }}>{ev.tipo}</div>
                </div>
                <StatusBadge status={ev.status} />
              </div>
              <div style={{ fontSize: 13, color: "#8892b0", marginBottom: 4 }}>📅 {fmtDate(ev.data)} ⏰ {ev.horaInicio}–{ev.horaFim}</div>
              <div style={{ fontSize: 13, color: "#8892b0", marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {ev.local}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex" }}>
                  {ev.equipe.slice(0, 4).map((m, i) => { const f = fl(m.freelancerId); return f ? <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}><Avatar nome={f.nome} size={26} /></div> : null; })}
                  {ev.equipe.length === 0 && <span style={{ fontSize: 12, color: "#4a5568" }}>Sem equipe</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>R$ {total.toFixed(2).replace(".", ",")}</div>
                    {pendente > 0 && <div style={{ fontSize: 11, color: "#f59e0b" }}>R$ {pendente.toFixed(2).replace(".", ",")} pend.</div>}
                  </div>
                  <button onClick={e => { e.stopPropagation(); setGcalModal(ev); }} style={{ background: "#1a73e822", border: "1px solid #1a73e855", borderRadius: 8, color: "#4285f4", cursor: "pointer", padding: "4px 7px", fontSize: 15 }}>📅</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Drawer lateral */}
      <>
        {det && <div onClick={() => setDetalhe(null)} style={{ position: "fixed", inset: 0, background: "#00000066", zIndex: 200 }} />}
        <div style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: det ? "min(460px, 100vw)" : 0, background: "#131827", borderLeft: "1px solid #2a3047", zIndex: 201, overflowY: "auto", overflowX: "hidden", transition: "width .28s ease" }}>
          {det && (
            <div style={{ padding: 22, minWidth: 300 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                <div style={{ flex: 1, paddingRight: 10 }}>
                  <h3 style={{ color: "#e2e8f0", margin: "0 0 6px", fontSize: 17 }}>{det.nome}</h3>
                  <StatusBadge status={det.status} />
                </div>
                <button onClick={() => setDetalhe(null)} style={{ background: "#2a3047", border: "none", color: "#8892b0", cursor: "pointer", fontSize: 18, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>

              <div style={{ background: "#0f1320", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: "#8892b0", display: "flex", flexDirection: "column", gap: 5 }}>
                <div>📅 {fmtDate(det.data)} &nbsp; ⏰ {det.horaInicio} — {det.horaFim}</div>
                <div>📍 {det.local}</div>
                {det.obs && <div>📝 {det.obs}</div>}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
                <Btn small variant="ghost" onClick={() => { setForm({ ...det }); setModal("novo"); }}>✏️ Editar</Btn>
                <Btn small onClick={() => setGcalModal(det)} style={{ background: "linear-gradient(135deg,#1a73e8,#4285f4)", color: "#fff", border: "none" }}>📅 Google Agenda</Btn>
              </div>

              <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14, marginBottom: 10 }}>👥 Equipe {det.equipe.length > 0 && <span style={{ color: "#8892b0", fontWeight: 400, fontSize: 12 }}>({det.equipe.length})</span>}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                {det.equipe.map((m, idx) => {
                  const f = fl(m.freelancerId); if (!f) return null;
                  return (
                    <div key={idx} style={{ background: "#0f1320", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <Avatar nome={f.nome} size={30} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 13 }}>{f.nome}</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                            <Badge label={m.funcao} color={CORES_FUNCAO[m.funcao] || "#6b7280"} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>R$ {m.cache.toFixed(2).replace(".", ",")}</span>
                            <span style={{ fontSize: 11, color: m.pago ? "#10b981" : "#f59e0b" }}>{m.pago ? "✅ Pago" : "🔴 Pendente"}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        <WaBtn url={waEscala(f, det, m)} tipo="escala" small />
                        {!m.pago && <WaBtn url={waPagamento(f, det, m)} tipo="pagamento" small />}
                        <Btn small variant={m.pago ? "ghost" : "success"} onClick={() => togglePago(det.id, idx)}>{m.pago ? "Desfazer" : "Pago ✓"}</Btn>
                        <Btn small variant="danger" onClick={() => removerMembro(det.id, idx)}>✕</Btn>
                      </div>
                    </div>
                  );
                })}
                {det.equipe.length === 0 && <div style={{ color: "#4a5568", fontSize: 13, textAlign: "center", padding: "8px 0" }}>Adicione membros abaixo 👇</div>}
              </div>

              {/* Adicionar membro */}
              <div style={{ background: "#0f1320", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 13, marginBottom: 10 }}>➕ Adicionar à Equipe</div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Selecionar Freelancer</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 190, overflowY: "auto", marginBottom: 10 }}>
                  {freelancers.filter(f => !det.equipe.find(m => m.freelancerId === f.id)).map(f => {
                    const alerta = verificarDisponibilidade(f.id, det);
                    const sel = membroForm.freelancerId === String(f.id);
                    return (
                      <button key={f.id} onClick={() => setMembroForm(fm => ({ ...fm, freelancerId: String(f.id) }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: sel ? "#8b5cf622" : "#1a1f2e", border: `1px solid ${sel ? "#8b5cf6" : alerta?.cor ? alerta.cor + "33" : "#2a3047"}`, borderRadius: 8, cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}>
                        <Avatar nome={f.nome} size={26} />
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.nome}</div>
                          {alerta && alerta.tipo !== "sem_info" && <div style={{ fontSize: 10, color: alerta.cor, marginTop: 1 }}>{alerta.tipo === "disponivel" ? "✅" : alerta.tipo === "indisponivel" ? "🚫" : alerta.tipo === "conflito" ? "❌" : "⚠️"} {alerta.msg}</div>}
                        </div>
                        {sel && <span style={{ color: "#8b5cf6" }}>✓</span>}
                      </button>
                    );
                  })}
                  {freelancers.filter(f => !det.equipe.find(m => m.freelancerId === f.id)).length === 0 && <div style={{ color: "#4a5568", fontSize: 12, textAlign: "center", padding: 8 }}>Todos já escalados!</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Select label="Função" value={membroForm.funcao} onChange={e => setMembroForm(f => ({ ...f, funcao: e.target.value }))}>
                    {FUNCOES.map(fn => <option key={fn}>{fn}</option>)}
                  </Select>
                  <Input label="Cachê (R$)" type="number" value={membroForm.cache} onChange={e => setMembroForm(f => ({ ...f, cache: e.target.value }))} placeholder="0,00" />
                  <Btn onClick={() => adicionarMembro(det.id)} style={{ width: "100%", justifyContent: "center", opacity: membroForm.freelancerId ? 1 : 0.4 }}>
                    ＋ Adicionar à Escala
                  </Btn>
                  {!membroForm.freelancerId && <div style={{ fontSize: 11, color: "#4a5568", textAlign: "center" }}>👆 Selecione um freelancer primeiro</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </>

      {/* Modal Novo/Editar */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={form.id ? "Editar Evento" : "Novo Evento"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Input label="Nome do Evento" value={form.nome || ""} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          <Select label="Tipo" value={form.tipo || "Aniversário Infantil"} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
            {["Aniversário Infantil","Aniversário Adulto","Corporativo","Escolar","Casamento","Formatura","Outro"].map(t => <option key={t}>{t}</option>)}
          </Select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Input label="Data" type="date" value={form.data || ""} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
            <Input label="Início" type="time" value={form.horaInicio || ""} onChange={e => setForm(f => ({ ...f, horaInicio: e.target.value }))} />
            <Input label="Fim" type="time" value={form.horaFim || ""} onChange={e => setForm(f => ({ ...f, horaFim: e.target.value }))} />
          </div>
          <Input label="Local" value={form.local || ""} onChange={e => setForm(f => ({ ...f, local: e.target.value }))} placeholder="Endereço completo" />
          <Select label="Status" value={form.status || "Confirmado"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {["Confirmado","Em negociação","Cancelado"].map(s => <option key={s}>{s}</option>)}
          </Select>
          <Input label="Observações" value={form.obs || ""} onChange={e => setForm(f => ({ ...f, obs: e.target.value }))} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
            <Btn onClick={salvarEvento}>💾 Salvar</Btn>
          </div>
        </div>
      </Modal>

      {/* Modal Conflito */}
      <Modal open={!!alertaConflito} onClose={() => setAlertaConflito(null)} title="⚠️ Conflito Detectado">
        {alertaConflito && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: alertaConflito.cor + "15", border: `1px solid ${alertaConflito.cor}44`, borderRadius: 12, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>{alertaConflito.tipo === "conflito" ? "❌" : "🚫"}</div>
              <div style={{ fontWeight: 700, color: alertaConflito.cor }}>{alertaConflito.freelancerNome}</div>
              <div style={{ fontSize: 13, color: "#8892b0", marginTop: 4 }}>{alertaConflito.msg}</div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn variant="ghost" onClick={() => setAlertaConflito(null)}>Cancelar</Btn>
              <Btn variant="danger" onClick={alertaConflito.onConfirmar}>Adicionar mesmo assim</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Google Calendar */}
      <Modal open={!!gcalModal} onClose={() => setGcalModal(null)} title="📅 Sincronizar com Google Agenda">
        {gcalModal && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#0f1320", borderRadius: 12, padding: 14, border: "1px solid #1a73e844", fontSize: 13, color: "#8892b0", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{gcalModal.nome}</div>
              <div>📅 {fmtDate(gcalModal.data)} ⏰ {gcalModal.horaInicio}–{gcalModal.horaFim}</div>
              <div>📍 {gcalModal.local}</div>
            </div>
            <Btn onClick={() => { window.open(buildGoogleCalendarUrl(gcalModal, freelancers), "_blank"); setGcalModal(null); }} style={{ background: "linear-gradient(135deg,#1a73e8,#4285f4)", border: "none", color: "#fff", justifyContent: "center" }}>
              🌐 Abrir no Google Calendar →
            </Btn>
            <Btn variant="ghost" onClick={() => { downloadICS(gcalModal, freelancers); setGcalModal(null); }} style={{ justifyContent: "center", borderColor: "#4285f4", color: "#4285f4" }}>
              ⬇️ Baixar .ics
            </Btn>
          </div>
        )}
      </Modal>
    </div>
  );
}
