// Public change log: a page (#/changes), a history section on each profile, a dashboard strip and an RSS feed.
import { S, h, url, api, toast, chrome, footer, STANCE, PARTY, fmtDate, markDirty, refresh } from "./main.js";
import { LEAN, ISSUE_POS } from "./views.js";

const $ = (s, el = document) => el.querySelector(s);
const FILTERS = {
	"": "All changes",
	"stance": "Medicare for All stance changes",
	"evidence,entry,entry_removed": "New evidence and entries",
	"lean,issue": "Lean and issue positions",
	"donor,donor_removed": "Donors",
	"profile,added,removed": "Profile updates",
};
const seatOf = (c) => (c.chamber === "senate" ? c.state : c.chamber === "house" ? `${c.state}-${c.district || "AL"}` : "");
const issueName = (id) => (S.data.issues || []).find((i) => i.id === id)?.name || id;
const pill = (s) => `<span class="pill"><i class="dot c-${h(s)}"></i>${h(STANCE[s] || s)}</span>`;

function what(c) {
	switch (c.kind) {
		case "stance": return `Medicare for All: ${pill(c.old || "unknown")} <span class="arrow">→</span> ${pill(c.new)}`;
		case "evidence": return "New evidence on their Medicare for All stance";
		case "lean": return `Lean: ${h(LEAN[c.old] || c.old)} <span class="arrow">→</span> <b>${h(LEAN[c.new] || c.new)}</b>`;
		case "issue": return `${h(issueName(c.field))}: ${h(ISSUE_POS[c.old] || c.old)} <span class="arrow">→</span> <b>${h(ISSUE_POS[c.new] || c.new)}</b>`;
		case "entry": return `New entry logged: <b>${h(c.new)}</b>`;
		case "entry_removed": return `Entry removed: ${h(c.old)}`;
		case "donor": return `Donor documented: <b>${h(c.new)}</b>`;
		case "donor_removed": return `Donor entry removed: ${h(c.old)}`;
		case "profile": return `${h(c.field.replace("_", " "))}: ${h(c.old ?? "blank")} <span class="arrow">→</span> <b>${h(c.new ?? "blank")}</b>`;
		case "added": return "Added to the tracker";
		case "removed": return `Removed from the tracker: ${h(c.old)}`;
		case "key_vote": return `Key vote updated (${h(c.field)})`;
		default: return h(c.kind);
	}
}
// A move away from support (or onto the record as opposed) is flagged red; toward support green.
const RANK = { supports: 4, public_option: 3, unclear: 2, unknown: 1, opposes: 0 };
const tone = (c) => (c.kind !== "stance" ? "" : RANK[c.new] > RANK[c.old || "unknown"] ? "up" : RANK[c.new] < RANK[c.old || "unknown"] ? "down" : "");

function row(c, withName = true) {
	const who = c.politician_id && c.politician_name ? `<a href="#/p/${h(c.politician_id)}">${h(c.politician_name)}</a> <span class="note">${h(c.party || "")}${seatOf(c) ? "-" + h(seatOf(c)) : ""}</span>` : "";
	return `<li class="chg ${tone(c)}${c.hidden ? " hiddenv" : ""}">
		<time>${h(fmtDate(c.at.slice(0, 10)))}</time>
		<div>${withName && who ? who + "<br>" : ""}${what(c)}
			${c.note && c.kind !== "evidence" ? `<div class="note">${h(c.note)}</div>` : c.kind === "evidence" && c.new ? `<div class="note">${h(c.new)}</div>` : ""}
			${c.source_url ? `<a class="note" href="${url(c.source_url)}" target="_blank" rel="noopener">Source ↗</a>` : ""}
			${c.actor === "data update" ? `<span class="tag">data update</span>` : ""}
			${S.admin ? ` <button type="button" class="btn small" data-hidechange="${c.id}" data-hidden="${c.hidden ? 0 : 1}">${c.hidden ? "Unhide" : "Hide"}</button>` : ""}</div>
	</li>`;
}

export async function renderChanges() {
	const f = S.chf || "";
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>What changed</h2><span><a href="/changes.xml">RSS feed</a> · subscribe for alerts</span></div>
		<p class="lede">Every change to a member's record on this site: stance changes, new evidence, documented donors and profile updates, newest first. Moves toward Medicare for All are green, moves away are red.</p>
		<div class="filters" style="position:static"><select id="chf">${Object.entries(FILTERS).map(([k, v]) => `<option value="${k}"${k === f ? " selected" : ""}>${v}</option>`).join("")}</select>
			<input type="search" id="chq" placeholder="Filter by name" value="${h(S.chq || "")}"></div>
		<ul class="chglist" id="chlist"><li class="note">Loading…</li></ul>
	</main>${footer()}`;
	let rows = [];
	try { rows = await api(`changes?limit=300${f ? "&kind=" + encodeURIComponent(f) : ""}`); } catch (e) { toast(e.message, true); }
	const q = (S.chq || "").toLowerCase();
	rows = rows.filter((c) => !q || (c.politician_name || "").toLowerCase().includes(q));
	$("#chlist").innerHTML = rows.map((c) => row(c)).join("") || `<li class="empty">Nothing yet. Changes appear here as the record is updated.</li>`;
}

export async function profileHistory(el, pid) {
	let rows = [];
	try { rows = await api(`changes?pid=${encodeURIComponent(pid)}&limit=50`); } catch { rows = []; }
	el.innerHTML = rows.length ? `<h3>History <small>${rows.length} change${rows.length === 1 ? "" : "s"} · <a href="#/changes">all changes</a></small></h3><ul class="chglist">${rows.map((c) => row(c, false)).join("")}</ul>` : "";
}

export async function recentStrip(el) {
	let rows = [];
	try { rows = await api("changes?kind=stance,entry&limit=6"); } catch { rows = []; }
	el.innerHTML = rows.length ? `<div class="section-title"><h2>Recent changes</h2><span><a href="#/changes">See all</a> · <a href="/changes.xml">RSS</a></span></div><ul class="chglist">${rows.map((c) => row(c)).join("")}</ul>` : "";
}

export function bindChanges() {
	document.addEventListener("change", (e) => { if (e.target.id === "chf") { S.chf = e.target.value; renderChanges(); } });
	document.addEventListener("input", (e) => {
		if (e.target.id === "chq") { S.chq = e.target.value; clearTimeout(bindChanges.t); bindChanges.t = setTimeout(async () => { await renderChanges(); const i = $("#chq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); }
	});
	document.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-hidechange]");
		if (!b) return;
		e.preventDefault(); e.stopPropagation();
		try { await api("admin/changes/" + b.dataset.hidechange, { method: "PUT", body: { hidden: b.dataset.hidden === "1" } }); toast(b.dataset.hidden === "1" ? "Hidden from the public log" : "Shown again"); markDirty(); await refresh(true); }
		catch (err) { toast(err.message, true); }
	});
}
