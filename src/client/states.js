// State government: governors (now and from 2027) and state legislators, with single-payer stances.
import { S, h, url, api, toast, chrome, footer, pill, avatar, STANCE, STANCE_ORDER, PARTY } from "./main.js";

const $ = (s, el = document) => el.querySelector(s);
const NAMES = {
	AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
	DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
	KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
	MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
	NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
	PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
	VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
export const stateName = (st) => NAMES[st] || st;
const CHAMBER = { state_upper: "State Senate", state_lower: "House / Assembly" };
let summary = null;

export async function renderStates() {
	$("#app").innerHTML = `${chrome()}<p class="loading">Loading state governments…</p>`;
	try { summary ??= await api("states"); } catch (e) { $("#app").innerHTML = `${chrome()}<p class="loading">${h(e.message)}</p>`; return; }
	const by = {};
	for (const r of summary.counts) {
		const s = (by[r.state] ||= { leg: 0, sup: 0 });
		if (r.chamber !== "governor") { s.leg += r.n; if (r.stance === "supports") s.sup += r.n; }
	}
	const gov2027 = {};
	for (const g of summary.governors) if (g.status !== "departing") gov2027[g.state] = gov2027[g.state] && gov2027[g.state].status === "incoming" ? gov2027[g.state] : g;
	const rows = Object.keys(NAMES).filter((st) => by[st] || gov2027[st]);
	const sort = S.stSort || "name";
	rows.sort(sort === "sup" ? (a, b) => (by[b]?.sup || 0) - (by[a]?.sup || 0) : (a, b) => NAMES[a].localeCompare(NAMES[b]));
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>State governments</h2><span>Governors and state legislators · single-payer stances</span></div>
		<p class="lede">States can pass their own single-payer systems, and governors sign or veto them. Legislators count as supporters when they sponsor or cosponsor a 2025–26 state single-payer bill; governors are researched one by one, with sources.</p>
		<div class="filters" style="position:static"><label class="check">Sort <select id="stsort"><option value="name"${sort === "name" ? " selected" : ""}>By state</option><option value="sup"${sort === "sup" ? " selected" : ""}>Most single-payer sponsors</option></select></label></div>
		<div class="tablewrap"><table class="t"><tr><th>State</th><th>Governor from 2027</th><th>Stance</th><th class="n">Legislators</th><th class="n">Single-payer sponsors</th></tr>
		${rows.map((st) => { const g = gov2027[st], s = by[st] || { leg: 0, sup: 0 }; return `<tr><td><a href="#/state/${st}"><b>${h(NAMES[st])}</b></a></td>
			<td>${g ? `<a href="#/p/${h(g.id)}">${h(g.name)}</a> <span class="party ${h(g.party)}">${h(g.party)}</span>${g.status === "incoming" ? ` <span class="tag new">New</span>` : ""}` : "—"}</td>
			<td>${g ? pill(g.stance) : ""}</td><td class="n">${s.leg}</td><td class="n">${s.sup ? `<b>${s.sup}</b>` : "—"}</td></tr>`; }).join("")}</table></div>
		<p class="note">Legislators from <a href="https://openstates.org" target="_blank" rel="noopener">Open States</a> (public domain), as currently seated; members elected in November 2026 appear as Open States updates. Governors-elect from the 2026 election results. State campaign money isn't covered yet.</p>
	</main>${footer()}`;
}

export async function renderState(st) {
	st = (st || "").toUpperCase();
	$("#app").innerHTML = `${chrome()}<p class="loading">Loading ${h(stateName(st))}…</p>`;
	let people = [];
	try { people = await api("state/" + encodeURIComponent(st)); } catch (e) { toast(e.message, true); }
	const govs = people.filter((p) => p.chamber === "governor");
	const f = (S.stf ||= { q: "", stance: "", party: "" });
	const card = (p) => `<button class="row" style="--stance:var(--s-${h(p.stance)})" data-id="${h(p.id)}">${avatar(p)}
		<span><span class="name">${h(p.name)}</span><br><span class="meta"><span class="party ${h(p.party)}">${h(p.party)}</span> · ${h(p.role)}${p.status === "incoming" ? " · takes office 2027" : p.status === "departing" ? " · leaving office" : ""}</span></span>
		<span class="right">${pill(p.stance)}</span></button>`;
	const list = (chamber) => {
		const q = f.q.toLowerCase();
		const rows = people.filter((p) => p.chamber === chamber && (!q || `${p.name} ${p.sdistrict}`.toLowerCase().includes(q)) && (!f.stance || p.stance === f.stance) && (!f.party || p.party === f.party))
			.sort((a, b) => STANCE_ORDER.indexOf(a.stance) - STANCE_ORDER.indexOf(b.stance) || String(a.sdistrict).localeCompare(String(b.sdistrict), undefined, { numeric: true }));
		const all = people.filter((p) => p.chamber === chamber);
		if (!all.length) return "";
		const sup = all.filter((p) => p.stance === "supports").length;
		return `<div class="section-title"><h2>${h(CHAMBER[chamber])}</h2><span>${all.length} members · ${sup} single-payer sponsor${sup === 1 ? "" : "s"}</span></div>
			<div class="list">${rows.map((p) => `<button class="row" style="--stance:var(--s-${h(p.stance)})" data-id="${h(p.id)}">${avatar(p)}
				<span><span class="name">${h(p.name)}</span><br><span class="meta"><span class="party ${h(p.party)}">${h(p.party)}</span> · District ${h(p.sdistrict || "?")}</span></span>
				<span class="right">${pill(p.stance)}${p.phone ? `<span>${h(p.phone)}</span>` : ""}</span></button>`).join("") || `<p class="empty">Nobody matches.</p>`}</div>`;
	};
	const opt = (v, l, cur) => `<option value="${h(v)}"${cur === v ? " selected" : ""}>${h(l)}</option>`;
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<p><a href="#/states">← All states</a></p>
		<div class="section-title"><h2>${h(stateName(st))}</h2><span><a href="#/elections/${h(st)}">2026 federal results</a></span></div>
		${govs.length ? `<h3 class="mini">${st === "DC" ? "Mayor" : "Governor"}</h3><div class="list compact">${govs.sort((a, b) => (a.status === "departing") - (b.status === "departing")).map(card).join("")}</div>` : ""}
		<div class="filters" style="position:static"><input type="search" id="stq" placeholder="Search name or district" value="${h(f.q)}">
			<select id="stst">${opt("", "Any stance", f.stance)}${STANCE_ORDER.map((s) => opt(s, STANCE[s], f.stance)).join("")}</select>
			<select id="stp">${opt("", "Any party", f.party)}${Object.entries(PARTY).map(([k, v]) => opt(k, v, f.party)).join("")}</select></div>
		<div id="stlists">${list("state_upper")}${list("state_lower")}</div>
		<p class="note">"Supports" for a legislator means they sponsored or cosponsored a 2025–26 single-payer bill in this state (the bill is linked on their profile). Everyone else shows "Not on record" until you add evidence. Legislators are as listed by Open States today.</p>
	</main>${footer()}`;
	renderState.redraw = () => { $("#stlists").innerHTML = list("state_upper") + list("state_lower"); };
}

export function bindStates() {
	document.addEventListener("change", (e) => {
		if (e.target.id === "stsort") { S.stSort = e.target.value; renderStates(); }
		if (e.target.id === "stst") { S.stf.stance = e.target.value; renderState.redraw?.(); }
		if (e.target.id === "stp") { S.stf.party = e.target.value; renderState.redraw?.(); }
	});
	document.addEventListener("input", (e) => { if (e.target.id === "stq") { S.stf.q = e.target.value; renderState.redraw?.(); } });
}
