"use client";
import { useState } from "react";
import { freelancersInit, eventosInit, dispInit } from "./data";
import { Sidebar } from "./UI";
import AbaEventos from "./AbaEventos";
import AbaEquipe from "./AbaEquipe";
import AbaDisponibilidade from "./AbaDisponibilidade";
import AbaRelatorios from "./AbaRelatorios";

export default function ScalaFest() {
  const [aba, setAba] = useState("eventos");
  const [freelancers, setFreelancers] = useState(freelancersInit);
  const [eventos, setEventos] = useState(eventosInit);
  const [disponibilidade, setDisponibilidade] = useState(dispInit);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; font-family: 'DM Sans', sans-serif; }
        body { margin: 0; background: #0a0e1a; }
        h1,h2,h3,h4 { font-family: 'Sora', sans-serif; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #0f1320; }
        ::-webkit-scrollbar-thumb { background: #2a3047; border-radius: 3px; }
        input[type=date]::-webkit-calendar-picker-indicator,
        input[type=time]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
        select option { background: #1a1f2e; }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "#0a0e1a" }}>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar desktop */}
          <div style={{ display: "none" }} className="desktop-sidebar">
            <Sidebar aba={aba} setAba={setAba} />
          </div>
          <style>{`@media(min-width:640px){.desktop-sidebar{display:flex!important}.mobile-nav{display:none!important}}`}</style>
          <Sidebar aba={aba} setAba={setAba} />

          <main style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {aba === "eventos" && <AbaEventos eventos={eventos} setEventos={setEventos} freelancers={freelancers} disponibilidade={disponibilidade} />}
            {aba === "equipe" && <AbaEquipe freelancers={freelancers} setFreelancers={setFreelancers} eventos={eventos} />}
            {aba === "disponibilidade" && <AbaDisponibilidade freelancers={freelancers} disponibilidade={disponibilidade} setDisponibilidade={setDisponibilidade} />}
            {aba === "relatorios" && <AbaRelatorios eventos={eventos} setEventos={setEventos} freelancers={freelancers} />}
          </main>
        </div>

        {/* Bottom nav mobile */}
        <Sidebar aba={aba} setAba={setAba} mobile />
      </div>
    </>
  );
}
