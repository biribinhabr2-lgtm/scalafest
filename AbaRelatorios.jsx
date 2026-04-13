export const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
export const initials = (n) => n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
export const avatarColor = (n) => {
  const colors = ["#f59e0b","#3b82f6","#a855f7","#10b981","#ec4899","#f97316","#6366f1","#14b8a6","#ef4444"];
  let h = 0; for (let c of n) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
};

// Google Calendar
export const toGCalDate = (data, hora) => {
  const [y, m, d] = data.split("-");
  const [hh, mm] = (hora || "00:00").split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
};
export const buildGoogleCalendarUrl = (evento, freelancers) => {
  const equipeDesc = evento.equipe.map(m => {
    const f = freelancers.find(x => x.id === m.freelancerId);
    return f ? `• ${f.nome} (${m.funcao})` : "";
  }).filter(Boolean).join("\n");
  const descricao = [`Tipo: ${evento.tipo}`, evento.obs ? `Obs: ${evento.obs}` : "", "", "EQUIPE:", equipeDesc].filter(x => x != null).join("\n");
  const params = new URLSearchParams({ action: "TEMPLATE", text: evento.nome, dates: `${toGCalDate(evento.data, evento.horaInicio)}/${toGCalDate(evento.data, evento.horaFim)}`, location: evento.local, details: descricao });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};
export const downloadICS = (evento, freelancers) => {
  const equipeDesc = evento.equipe.map(m => { const f = freelancers.find(x => x.id === m.freelancerId); return f ? `${f.nome} (${m.funcao})` : ""; }).filter(Boolean).join(", ");
  const uid = `scalafest-${evento.id}-${Date.now()}@scalafest`;
  const now = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//ScalaFest//PT","BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${now}`,`DTSTART:${toGCalDate(evento.data, evento.horaInicio)}`,`DTEND:${toGCalDate(evento.data, evento.horaFim)}`,`SUMMARY:${evento.nome}`,`LOCATION:${evento.local}`,`DESCRIPTION:Equipe: ${equipeDesc}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${evento.nome.replace(/[^a-z0-9]/gi, "_")}.ics`; a.click(); URL.revokeObjectURL(url);
};

// WhatsApp
export const limparTel = (tel) => tel ? tel.replace(/\D/g, "") : "";
export const waEscala = (freelancer, evento, membro) => {
  const tel = limparTel(freelancer.telefone);
  if (!tel) return null;
  const msg = `Olá, *${freelancer.nome}*! 👋\n\nVocê foi escalado(a) para:\n\n🎪 *${evento.nome}*\n📅 ${fmtDate(evento.data)}\n⏰ ${evento.horaInicio} — ${evento.horaFim}\n📍 ${evento.local}\n🎭 Função: *${membro.funcao}*\n💰 Cachê: *R$ ${membro.cache.toFixed(2).replace(".",",")}*\n\nConfirme sua presença! Obrigado 🙏`;
  return `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
};
export const waPagamento = (freelancer, evento, membro) => {
  const tel = limparTel(freelancer.telefone);
  if (!tel) return null;
  const msg = `Olá, *${freelancer.nome}*! 👋\n\nO pagamento abaixo está *pendente*:\n\n🎪 *${evento.nome}*\n📅 ${fmtDate(evento.data)}\n🎭 Função: *${membro.funcao}*\n💰 Cachê: *R$ ${membro.cache.toFixed(2).replace(".",",")}*${freelancer.pix ? `\n\n💳 PIX: *${freelancer.pix}*` : ""}\n\nObrigado! ✅`;
  return `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
};
