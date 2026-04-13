export const FUNCOES = ["Líder", "Auxiliar", "Personagem", "Apoio", "Motorista", "Animador", "DJ", "Fotógrafo"];
export const CORES_FUNCAO = {
  "Líder": "#f59e0b", "Auxiliar": "#3b82f6", "Personagem": "#a855f7",
  "Apoio": "#10b981", "Motorista": "#6366f1", "Animador": "#ec4899",
  "DJ": "#f97316", "Fotógrafo": "#14b8a6"
};

export const freelancersInit = [
  { id: 1, nome: "Ana Beatriz", telefone: "(11) 99999-1111", funcoes: ["Líder", "Animador"], pix: "ana@pix.com", obs: "" },
  { id: 2, nome: "Carlos Mendes", telefone: "(11) 99999-2222", funcoes: ["Motorista", "Apoio"], pix: "carlos@pix.com", obs: "Tem van" },
  { id: 3, nome: "Fernanda Lima", telefone: "(11) 99999-3333", funcoes: ["Personagem", "Auxiliar"], pix: "fer@pix.com", obs: "" },
  { id: 4, nome: "Rafael Costa", telefone: "(11) 99999-4444", funcoes: ["DJ", "Animador"], pix: "rafael@pix.com", obs: "" },
  { id: 5, nome: "Juliana Neves", telefone: "(11) 99999-5555", funcoes: ["Fotógrafo"], pix: "juli@pix.com", obs: "" },
  { id: 6, nome: "Pedro Alves", telefone: "(11) 99999-6666", funcoes: ["Líder", "Auxiliar"], pix: "pedro@pix.com", obs: "" },
  { id: 7, nome: "Mariana Souza", telefone: "(11) 99999-7777", funcoes: ["Personagem", "Animador"], pix: "mari@pix.com", obs: "" },
  { id: 8, nome: "Lucas Ferreira", telefone: "(11) 99999-8888", funcoes: ["Apoio", "Motorista"], pix: "lucas@pix.com", obs: "" },
];

export const eventosInit = [
  {
    id: 1, nome: "Festa da Princesa — Sofia", tipo: "Aniversário Infantil",
    data: "2026-04-18", horaInicio: "14:00", horaFim: "18:00",
    local: "Rua das Flores, 123 — São Paulo", status: "Confirmado", obs: "",
    equipe: [
      { freelancerId: 1, funcao: "Líder", cache: 280, pago: false },
      { freelancerId: 3, funcao: "Personagem", cache: 200, pago: false },
      { freelancerId: 7, funcao: "Animador", cache: 180, pago: true },
    ]
  },
  {
    id: 2, nome: "Evento Corporativo TechBR", tipo: "Corporativo",
    data: "2026-04-22", horaInicio: "09:00", horaFim: "17:00",
    local: "Av. Paulista, 1000 — São Paulo", status: "Confirmado", obs: "Coffee break incluso",
    equipe: [
      { freelancerId: 6, funcao: "Líder", cache: 350, pago: true },
      { freelancerId: 2, funcao: "Motorista", cache: 220, pago: false },
      { freelancerId: 5, funcao: "Fotógrafo", cache: 400, pago: false },
    ]
  },
  {
    id: 3, nome: "Festa Junina Colégio Esperança", tipo: "Escolar",
    data: "2026-05-10", horaInicio: "10:00", horaFim: "15:00",
    local: "Rua da Escola, 45 — Osasco", status: "Em negociação", obs: "",
    equipe: [
      { freelancerId: 4, funcao: "DJ", cache: 300, pago: false },
      { freelancerId: 8, funcao: "Apoio", cache: 150, pago: false },
    ]
  },
];

export const dispInit = {
  1: { "2026-04-18": "disponivel", "2026-04-19": "indisponivel", "2026-04-20": "disponivel" },
  2: { "2026-04-18": "parcial", "2026-04-22": "disponivel" },
  3: { "2026-04-18": "disponivel", "2026-04-20": "indisponivel" },
};
