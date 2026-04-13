"use client";
import { useState } from "react";
import { FUNCOES, CORES_FUNCAO } from "./data";
import { Avatar, Badge, Card, Input, Select, Btn, Modal } from "./UI";

export default function AbaEquipe({ freelancers, setFreelancers, eventos }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [busca, setBusca] = useState("");

  const salvar = () => {
    if (!form.nome) return;
    if (form.id) setFreelancers(fl => fl.map(f => f.id === form.id ? { ...form } : f));
    else setFreelancers(fl => [...fl, { ...form, id: Date.now() }]);
    setModal(false);
  };
  const toggleFuncao = (fn) => setForm(f => ({ ...f, funcoes: (f.funcoes || []).includes(fn) ? f.funcoes.filter(x => x !== fn) : [...(f.funcoes || []), fn] }));
  const eventosDoFreelancer = (id) => eventos.filter(ev => ev.equipe.find(m => m.freelancerId === id)).length;
  const filtrado = freelancers.filter(f => f.nome.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 22 }}>👥 Equipe</h2>
          <p style={{ color: "#6b7280", margin: "4px 0 0", fontSize: 13 }}>{freelancers.length} profissionais</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar..." style={{ background: "#1a1f2e", border: "1px solid #2a3047", borderRadius: 10, padding: "8px 14px", color: "#e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
          <Btn onClick={() => { setForm({ nome: "", telefone: "", email: "", funcoes: [], pix: "", obs: "" }); setModal(true); }}>＋ Novo Freelancer</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
        {filtrado.map(f => (
          <Card key={f.id}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
              <Avatar nome={f.nome} size={42} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 15 }}>{f.nome}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>📱 {f.telefone}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{eventosDoFreelancer(f.id)} eventos</div>
              </div>
              <Btn small variant="ghost" onClick={() => { setForm({ ...f }); setModal(true); }}>✏️</Btn>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(f.funcoes || []).map(fn => <Badge key={fn} label={fn} color={CORES_FUNCAO[fn] || "#6b7280"} />)}
            </div>
            {f.pix && <div style={{ marginTop: 8, fontSize: 11, color: "#4a5568" }}>💳 {f.pix}</div>}
            {f.obs && <div style={{ marginTop: 4, fontSize: 11, color: "#4a5568", fontStyle: "italic" }}>📝 {f.obs}</div>}
          </Card>
        ))}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? "Editar Freelancer" : "Novo Freelancer"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Input label="Nome Completo" value={form.nome || ""} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          <Input label="Telefone / WhatsApp" value={form.telefone || ""} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} placeholder="(11) 99999-0000" />
          <Input label="E-mail" value={form.email || ""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <Input label="Chave PIX" value={form.pix || ""} onChange={e => setForm(f => ({ ...f, pix: e.target.value }))} />
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Funções</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {FUNCOES.map(fn => (
                <button key={fn} onClick={() => toggleFuncao(fn)} style={{ background: (form.funcoes || []).includes(fn) ? CORES_FUNCAO[fn] + "33" : "#0f1320", border: `1px solid ${(form.funcoes || []).includes(fn) ? CORES_FUNCAO[fn] : "#2a3047"}`, color: (form.funcoes || []).includes(fn) ? CORES_FUNCAO[fn] : "#6b7280", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{fn}</button>
              ))}
            </div>
          </div>
          <Input label="Observações" value={form.obs || ""} onChange={e => setForm(f => ({ ...f, obs: e.target.value }))} placeholder="Ex: não dirige, só fins de semana..." />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn variant="ghost" onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn onClick={salvar}>💾 Salvar</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
