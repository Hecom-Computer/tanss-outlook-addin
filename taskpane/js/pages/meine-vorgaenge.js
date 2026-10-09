import { T } from "../../i18n/de.js";
import * as api from "../api.js";
import * as office from "../office.js";
import * as ui from "../ui.js";

function open(ctx, ticket) {
  try {
    const url = new URL(ctx.me.tanssFrontendUrl);
    url.hash = `#/ticket/${Number(ticket.id)}`;
    if (!office.openInBrowser(url.href)) ctx.showError({ code: "CLIENT_OFFICE_FAILED" });
  } catch { ctx.showError({ code: "CLIENT_OFFICE_FAILED" }); }
}

// Der Router ruft bei jeder Seite einheitlich `render(ctx)` auf. Diese Ansicht war
// versehentlich noch mit dem alten Namen `mount` exportiert und brach deshalb bereits
// vor dem ersten TANSS-Abruf ab.
export async function render(ctx) {
  const assigned = ui.el("div", { class: "stack" });
  const recent = ui.el("div", { class: "stack" });
  const results = ui.el("div", { class: "stack" });
  const row = (ticket) => ui.listRow({ title: `#${ticket.id} · ${ticket.title || T.app.unknown}`, subtitle: ticket.companyName || "", badgeLabel: ticket.statusName || "", onClick: () => open(ctx, ticket) });
  const search = ui.searchField({ placeholder: T.myWork.searchPlaceholder, minChars: 2, onSearch: async (q) => {
    const result = await api.get("api/search/tickets", { query: { q, scope: "all", limit: 25 }, signal: ctx.signal });
    if (ctx.signal.aborted) return;
    if (!result.ok) return ctx.showError(result.error);
    ui.replace(results, ui.section({ heading: T.ticketAnhaengen.results, children: [ui.list({ items: result.data.items || [], renderItem: row })] }));
  }});
  ui.replace(ctx.root, search.root, assigned, recent, results);
  const [mine, last] = await Promise.all([api.get("api/tickets/own", { query: {}, signal: ctx.signal }), api.get("api/search/tickets", { query: { q: "", scope: "all" }, signal: ctx.signal })]);
  if (ctx.signal.aborted) return;
  if (mine.ok) ui.replace(assigned, ui.section({ heading: T.myWork.assigned, children: [mine.data.length ? ui.list({ items: mine.data, renderItem: row }) : ui.el("p", { class: "muted", text: T.myWork.noAssigned })] })); else ctx.showError(mine.error);
  const items = last.ok && Array.isArray(last.data.recent) ? last.data.recent : [];
  ui.replace(recent, ui.section({ heading: T.myWork.recent, children: [items.length ? ui.list({ items, renderItem: row }) : ui.el("p", { class: "muted", text: T.myWork.noRecent })] }));
}
