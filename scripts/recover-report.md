# Relatório de Recuperação de Eventos

> **Modo:** DRY-RUN &nbsp;·&nbsp; **Período:** 2025-09-01 → 2026-09-10 &nbsp;·&nbsp; **Gerado em:** 12/09/2026, 14:13:10

## Resumo Global

| Métrica | Valor |
|---------|------:|
| Eventos a recuperar | **0** |
| ↳ Casados com ID original | 0 |
| ↳ Somente calendário (sem feedback) | 0 |
| Pulados (já existiam no banco) | 0 |
| IDs de confirmações sem evento | 0 |

## Grau de Confiança

| Nível | Descrição |
|-------|-----------|
| `casou_com_id_original` | Evento encontrado nos feedbacks pelo nome+data; ID original recuperado. Confirmações e feedbacks voltam a casar. |
| `casou_com_id_original+backup` | Idem acima, mais dados completos do backup (equipe, cache, tipo). |
| `so_calendario+backup_id` | Sem feedback mas backup tem o evento; ID extraído do backup. |
| `so_calendario+backup` | Sem feedback, backup tem o evento mas não há ID confiável; UUID novo gerado. |
| `so_calendario` | Apenas Google Calendar, sem outras fontes. UUID novo. Equipe vazia — preencher manualmente. |

---

## Tenant `0dca36f1-d897-402b-b794-55fece2a6ef2`

*Nenhum evento novo a recuperar para este tenant.*

---

*Gerado por `scripts/recover-eventos.js`*