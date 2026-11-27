// Follow the money: PAC / super PAC matrix, megadonors, committee and donor pages, flow charts,
// a per-member money web, and full voting records. Data: /money/*.json and /votes/*.json (static, built
// from FEC and Voteview bulk data by scripts/money_network.py and scripts/vote_records.py).
import { S, h, url, chrome, footer, money, short, PARTY, seat, toast } from "./main.js";

const $ = (s, el = document) => el.querySelector(s);
let M = null, D = null;
async function loadMoney() {
	if (!M) {
		const [c, d] = await Promise.all([fetch("/money/committees.json").then((r) => r.json()), fetch("/money/donors.json").then((r) => r.json())]);
		M = c; D = d;
	}
	return { C: M.committees, names: M.names, donors: D };
}
const cname = (id) => M?.committees[id]?.n || M?.names?.[id] || id;
const KIND = { person: "Person", organization: "Company or nonprofit", committee: "Political committee" };

// ------------------------------------------------------------------ charts (D3 + d3-sankey, loaded on demand)
let d3p = null;
function loadD3() {
	const add = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
	d3p ??= add("https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js").then(() => add("https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js"));
	return d3p;
}
const COLOR = { donor: "var(--ink-3)", D: "var(--p-D)", R: "var(--p-R)", I: "var(--p-I)", mixed: "var(--s-unclear)", against: "var(--s-opposes)", node: "var(--ink-2)" };

async function sankey(el, nodes, links, opts = {}) {
	if (!links.length) { el.innerHTML = `<p class="note">Not enough itemized money to chart.</p>`; return; }
	try { await loadD3(); } catch { el.innerHTML = `<p class="note">The chart library couldn't load. The tables below have the same figures.</p>`; return; }
	const d3 = window.d3;
	const W = Math.max(el.clientWidth, 720), H = opts.height || Math.max(360, Math.min(900, nodes.length * 26));
	const narrow = false; // narrow screens scroll the chart instead of squeezing it
	// Align by depth so a committee that only funds other committees stays in the middle column.
	const gen = d3.sankey().nodeId((d) => d.id).nodeAlign(d3.sankeyLeft).nodeWidth(12).nodePadding(narrow ? 6 : 10).extent([[1, 6], [W - 1, H - 6]]);
	const g = gen({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) });
	const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("class", "sankey").attr("role", "img").attr("aria-label", opts.label || "Money flow chart");
	svg.append("g").attr("fill", "none").selectAll("path").data(g.links).join("path")
		.attr("d", d3.sankeyLinkHorizontal()).attr("stroke", (d) => d.color || COLOR[d.target.kind] || COLOR.node)
		.attr("stroke-opacity", 0.32).attr("stroke-width", (d) => Math.max(1, d.width))
		.append("title").text((d) => `${d.source.name} → ${d.target.name}: ${money(d.value)}${d.note ? " (" + d.note + ")" : ""}`);
	const node = svg.append("g").selectAll("g").data(g.nodes).join("g");
	node.append("rect").attr("x", (d) => d.x0).attr("y", (d) => d.y0).attr("height", (d) => Math.max(1, d.y1 - d.y0)).attr("width", (d) => d.x1 - d.x0)
		.attr("rx", 2).attr("fill", (d) => d.color || COLOR[d.kind] || COLOR.node)
		.style("cursor", (d) => (d.href ? "pointer" : "default")).on("click", (e, d) => { if (d.href) location.hash = d.href; })
		.append("title").text((d) => `${d.name}: ${money(d.value)}`);
	node.append("text").attr("x", (d) => (d.x0 < W / 2 ? d.x1 + 6 : d.x0 - 6)).attr("y", (d) => (d.y0 + d.y1) / 2).attr("dy", "0.35em")
		.attr("text-anchor", (d) => (d.x0 < W / 2 ? "start" : "end")).attr("class", "slabel")
		.text((d) => { const n = d.name.length > (narrow ? 18 : 34) ? d.name.slice(0, narrow ? 17 : 33) + "…" : d.name; return d.y1 - d.y0 < 7 && narrow ? "" : `${n} ${short(d.value)}`; })
		.style("cursor", (d) => (d.href ? "pointer" : "default")).on("click", (e, d) => { if (d.href) location.hash = d.href; });
	el.innerHTML = "";
	el.appendChild(svg.node());
}

const lean = (c) => {
	const s = c.s || {}, r = (s.forR || 0) + (s.agD || 0), d = (s.forD || 0) + (s.agR || 0);
	return r + d === 0 ? (c.p === "DEM" ? "D" : c.p === "REP" ? "R" : "mixed") : r > d * 3 ? "R" : d > r * 3 ? "D" : "mixed";
};
const leanLabel = { D: "Helps Democrats", R: "Helps Republicans", mixed: "Mixed / both" };

// ------------------------------------------------------------------ money page
export async function renderMoney(path) {
	$("#app").innerHTML = `${chrome()}<p class="loading">Loading the money data…</p>`;
	let data;
	try { data = await loadMoney(); } catch (e) { $("#app").innerHTML = `${chrome()}<p class="loading">Couldn't load the money data.</p>`; return; }
	const [kind, id] = path;
	if (kind === "c" && id) return committeePage(decodeURIComponent(id));
	if (kind === "d" && id) return donorPage(decodeURIComponent(id));
	const tab = kind || "flow";
	const tabs = [["flow", "Flow chart"], ["matrix", "PAC & super PAC matrix"], ["donors", "Megadonors"]];
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>Follow the money</h2><span>2025–26 cycle · federal races · FEC filings</span></div>
		<p class="lede">Who the biggest donors are, which PACs and super PACs they fund, and which candidates that money helps or attacks. Click any committee or donor to see its connections.</p>
		<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-mtab="${k}">${l}</button>`).join("")}</div>
		<div id="mbody"></div>
		<p class="note">Itemized gifts of $1,000 or more from FEC bulk data. Pass-through processors (ActBlue, WinRed) and joint-fundraising re-allocations aren't double counted. "Companies and nonprofits" can include 501(c)(4) groups, which don't have to disclose their own donors. State races aren't included yet.</p>
	</main>${footer()}`;
	if (tab === "matrix") matrix(data);
	else if (tab === "donors") donorList(data);
	else flow(data);
}

function flow({ C, donors }) {
	const st = (S.flow ||= { from: "person", group: "candidate", dir: "for", n: 12 });
	$("#mbody").innerHTML = `<div class="filters" style="position:static">
		<label class="check">Start from <select data-flow="from"><option value="person">Top individual donors</option><option value="organization">Top companies and nonprofits</option><option value="committee">Committees funding committees</option><option value="all">All big donors</option></select></label>
		<label class="check">Group recipients by <select data-flow="group"><option value="candidate">Candidate</option><option value="party">Party</option><option value="state">State</option></select></label>
		<label class="check">Show money spent <select data-flow="dir"><option value="for">to help candidates</option><option value="against">to attack candidates</option></select></label>
		<label class="check">Donors <select data-flow="n"><option>8</option><option>12</option><option>20</option></select></label>
	</div><div id="flowchart" class="chartbox"></div>
	<p class="note">Left: donors. Middle: the committees they fund (super PACs, PACs, party committees). Right: where those committees' money went, as direct gifts plus outside spending. Committees also have other funders, so the right side shows each committee's total spending, not only these donors' share. Hover a band for the amount; click a node to open it.</p>`;
	for (const [k, v] of Object.entries(st)) { const s = $(`[data-flow="${k}"]`); if (s) s.value = String(v); }
	const ds = donors.filter((d) => st.from === "all" || d.kind === st.from).slice(0, Number(st.n));
	const nodes = new Map(), links = [];
	const add = (id, o) => { if (!nodes.has(id)) nodes.set(id, { id, ...o }); };
	const cmteIn = new Map();
	for (const d of ds) {
		add("d:" + d.k, { name: d.n, kind: "donor", href: "#/money/d/" + encodeURIComponent(d.k) });
		for (const [cid, v] of d.to.slice(0, 6)) {
			if (!C[cid] || v <= 0) continue;
			cmteIn.set(cid, (cmteIn.get(cid) || 0) + v);
			links.push({ source: "d:" + d.k, target: "c:" + cid, value: v });
		}
	}
	const cm = [...cmteIn.keys()];
	for (const cid of cm) add("c:" + cid, { name: C[cid].n, kind: lean(C[cid]), href: "#/money/c/" + cid });
	const tgt = new Map();
	for (const cid of cm) {
		for (const [pid, name, party, stt, dir, sup, opp] of C[cid].rec) {
			const v = st.dir === "for" ? dir + sup : opp;
			if (v <= 0) continue;
			const key = st.group === "party" ? "p:" + (party || "O") : st.group === "state" ? "s:" + (stt || "?") : "t:" + (pid || name);
			const label = st.group === "party" ? (PARTY[party] ? PARTY[party] + "s" : "Others") : st.group === "state" ? (stt || "Unknown") : (pid && S.byId.get(pid)?.name) || name;
			if (!tgt.has(key)) tgt.set(key, { label, party, pid, links: [] });
			tgt.get(key).links.push([cid, v]);
		}
	}
	let tlist = [...tgt.entries()].map(([k, t]) => ({ k, ...t, total: t.links.reduce((a, l) => a + l[1], 0) })).sort((a, b) => b.total - a.total);
	const keep = tlist.slice(0, 22), rest = tlist.slice(22);
	for (const t of keep) {
		add(t.k, { name: t.label, kind: st.dir === "against" ? "against" : t.party || "mixed", href: t.pid ? "#/p/" + encodeURIComponent(t.pid) : null });
		for (const [cid, v] of t.links) links.push({ source: "c:" + cid, target: t.k, value: v, color: st.dir === "against" ? COLOR.against : undefined });
	}
	if (rest.length) {
		add("other", { name: `${rest.length} more`, kind: "node" });
		const agg = new Map();
		for (const t of rest) for (const [cid, v] of t.links) agg.set(cid, (agg.get(cid) || 0) + v);
		for (const [cid, v] of agg) links.push({ source: "c:" + cid, target: "other", value: v });
	}
	sankey($("#flowchart"), [...nodes.values()], links, { label: "Donors to committees to candidates" });
}

function matrix({ C }) {
	const q = (S.mq || "").toLowerCase(), tf = S.mt || "";
	const rows = Object.entries(C).filter(([, c]) => (!q || c.n.toLowerCase().includes(q)) && (!tf || c.t === tf))
		.sort((a, b) => (b[1].x + b[1].g) - (a[1].x + a[1].g)).slice(0, 80);
	const types = [...new Set(Object.values(C).map((c) => c.t))].sort();
	const max = Math.max(1, ...rows.flatMap(([, c]) => [c.s.forD, c.s.forR, c.s.agD, c.s.agR]));
	const cell = (v, kind) => `<td class="n hcell" style="--a:${Math.min(1, Math.sqrt(v / max)).toFixed(3)};--c:var(--${kind})">${v ? short(v) : "—"}</td>`;
	$("#mbody").innerHTML = `<div class="filters" style="position:static">
		<input type="search" id="mq" placeholder="Search committees" value="${h(S.mq || "")}">
		<select id="mt"><option value="">All types</option>${types.map((t) => `<option${t === tf ? " selected" : ""}>${h(t)}</option>`).join("")}</select></div>
		<div class="tablewrap"><table class="t matrix2"><tr><th>Committee</th><th>Type</th><th class="n">Raised</th><th class="n">For Dems</th><th class="n">For Reps</th><th class="n">Against Dems</th><th class="n">Against Reps</th><th>Biggest funder</th></tr>
		${rows.map(([cid, c]) => `<tr><td><a href="#/money/c/${cid}">${h(c.n)}</a>${c.lead ? `<br><span class="note">Leadership PAC of ${h(S.byId.get(c.lead)?.name || "")}</span>` : ""}</td><td><span class="tag">${h(c.t)}</span></td><td class="n">${c.r ? short(c.r) : "—"}</td>
			${cell(c.s.forD, "p-D")}${cell(c.s.forR, "p-R")}${cell(c.s.agD, "s-opposes")}${cell(c.s.agR, "s-opposes")}
			<td>${c.donors[0] && !(c.from[0] && c.from[0][1] > c.donors[0][2]) ? `${h(c.donors[0][0])} <span class="note">${short(c.donors[0][2])}</span>` : c.from[0] ? `<a href="#/money/c/${c.from[0][0]}">${h(cname(c.from[0][0]))}</a> <span class="note">${short(c.from[0][1])}</span>` : "—"}</td></tr>`).join("")}</table></div>
		<p class="note">Top 80 by money spent on candidates (direct gifts plus outside spending). Darker cells mean more money. "For" includes direct contributions and ads supporting; "Against" is ads attacking.</p>`;
}

function donorList({ donors }) {
	const kf = S.dk || "person", q = (S.dq || "").toLowerCase();
	const rows = donors.filter((d) => (kf === "all" || d.kind === kf) && (!q || `${d.n} ${d.emp} ${d.city} ${d.st}`.toLowerCase().includes(q))).slice(0, 150);
	$("#mbody").innerHTML = `<div class="filters" style="position:static">
		<select id="dk"><option value="person"${kf === "person" ? " selected" : ""}>People ($1M+)</option><option value="organization"${kf === "organization" ? " selected" : ""}>Companies and nonprofits ($250k+)</option><option value="committee"${kf === "committee" ? " selected" : ""}>Committees giving to committees</option><option value="all"${kf === "all" ? " selected" : ""}>All</option></select>
		<input type="search" id="dq" placeholder="Search name, employer or place" value="${h(S.dq || "")}"></div>
		<div class="tablewrap"><table class="t"><tr><th>Donor</th><th>Where / employer</th><th class="n">Gave</th><th>Main recipients</th></tr>
		${rows.map((d) => `<tr><td><a href="#/money/d/${encodeURIComponent(d.k)}">${h(d.n)}</a><br><span class="tag">${h(KIND[d.kind])}</span></td>
			<td class="note">${h([d.city, d.st].filter(Boolean).join(", "))}${d.emp ? `<br>${h(d.emp)}${d.occ ? " · " + h(d.occ) : ""}` : ""}</td>
			<td class="n">${money(d.total)}</td>
			<td>${d.to.slice(0, 3).map(([cid, v]) => `<a href="#/money/c/${cid}">${h(cname(cid))}</a> <span class="note">${short(v)}</span>`).join("<br>")}</td></tr>`).join("")}</table></div>
		<p class="note">People are matched by name and state, so two different people with the same name in one state would be combined. Totals are itemized gifts of $1,000 or more.</p>`;
}

function committeePage(cid) {
	const c = M.committees[cid];
	if (!c) { $("#app").innerHTML = `${chrome()}<main class="wrap"><p class="empty">Committee not found. <a href="#/money">Back to the money page</a></p></main>`; return; }
	const lp = c.lead && S.byId.get(c.lead);
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<p><a href="#/money/matrix">← All committees</a></p>
		<div class="section-title"><h2>${h(c.n)}</h2><span>${h(c.t)} · <a href="https://www.fec.gov/data/committee/${h(cid)}/" target="_blank" rel="noopener">FEC filings ↗</a></span></div>
		${lp ? `<p class="lede">Leadership PAC controlled by <a href="#/p/${h(lp.id)}">${h(lp.name)}</a>.</p>` : c.o ? `<p class="lede">Connected organization: ${h(c.o)}</p>` : ""}
		<div class="kv"><div><b>${money(c.r)}</b><span>Raised</span></div><div><b>${money(c.i)}</b><span>From individuals</span></div><div><b>${money(c.c)}</b><span>From other committees</span></div>
			<div><b>${money(c.s.forD)}</b><span>For Democrats</span></div><div><b>${money(c.s.forR)}</b><span>For Republicans</span></div><div><b>${money(c.s.agD + c.s.agR)}</b><span>Attacking candidates</span></div></div>
		<div id="cchart" class="chartbox"></div>
		<div class="grid2">
			<section><h3>Biggest donors</h3>${c.donors.length ? `<table class="t">${c.donors.map(([n, k, v, key]) => `<tr><td>${D.some((d) => d.k === key) ? `<a href="#/money/d/${encodeURIComponent(key)}">${h(n)}</a>` : h(n)} <span class="tag">${h(KIND[k === "IND" ? "person" : k === "ORG" ? "organization" : "committee"])}</span></td><td class="n">${money(v)}</td></tr>`).join("")}</table>` : `<p class="note">No itemized donors of $1,000+ (it may be funded by other committees).</p>`}
			<h3>Money from other committees</h3>${c.from.length ? `<table class="t">${c.from.map(([id, v]) => `<tr><td>${M.committees[id] ? `<a href="#/money/c/${id}">${h(cname(id))}</a>` : h(cname(id))}</td><td class="n">${money(v)}</td></tr>`).join("")}</table>` : `<p class="note">None recorded.</p>`}
			<h3>Money sent to other committees</h3>${c.to.length ? `<table class="t">${c.to.map(([id, v]) => `<tr><td>${M.committees[id] ? `<a href="#/money/c/${id}">${h(cname(id))}</a>` : h(cname(id))}</td><td class="n">${money(v)}</td></tr>`).join("")}</table>` : `<p class="note">None recorded.</p>`}</section>
			<section><h3>Candidates it backed or attacked</h3>${c.rec.length ? `<table class="t"><tr><th>Candidate</th><th class="n">Gave</th><th class="n">Ads for</th><th class="n">Ads against</th></tr>${c.rec.map(([pid, name, party, st, d, s, o]) => `<tr><td>${pid ? `<a href="#/p/${h(pid)}">${h(S.byId.get(pid)?.name || name)}</a>` : h(name)} <span class="party ${h(party)}">${h(party)}</span> <span class="note">${h(st)}</span></td><td class="n">${d ? short(d) : "—"}</td><td class="n">${s ? short(s) : "—"}</td><td class="n">${o ? short(o) : "—"}</td></tr>`).join("")}</table>` : `<p class="note">No candidate spending recorded.</p>`}</section>
		</div>
	</main>${footer()}`;
	const nodes = [{ id: "me", name: c.n, kind: lean(c) }], links = [];
	c.donors.slice(0, 10).forEach(([n, k, v, key], i) => { nodes.push({ id: "d" + i, name: n, kind: "donor", href: D.some((d) => d.k === key) ? "#/money/d/" + encodeURIComponent(key) : null }); links.push({ source: "d" + i, target: "me", value: v }); });
	c.from.slice(0, 6).forEach(([id, v], i) => { nodes.push({ id: "f" + i, name: cname(id), kind: M.committees[id] ? lean(M.committees[id]) : "node", href: M.committees[id] ? "#/money/c/" + id : null }); links.push({ source: "f" + i, target: "me", value: v }); });
	c.rec.slice(0, 14).forEach(([pid, name, party, st, d, s, o], i) => {
		if (d + s > 0) { nodes.push({ id: "r" + i, name: (pid && S.byId.get(pid)?.name) || name, kind: party || "mixed", href: pid ? "#/p/" + encodeURIComponent(pid) : null }); links.push({ source: "me", target: "r" + i, value: d + s }); }
		if (o > 0) { nodes.push({ id: "o" + i, name: `Against ${(pid && S.byId.get(pid)?.name) || name}`, kind: "against", href: pid ? "#/p/" + encodeURIComponent(pid) : null }); links.push({ source: "me", target: "o" + i, value: o, color: COLOR.against }); }
	});
	sankey($("#cchart"), nodes, links, { label: `Money into and out of ${c.n}` });
}

function donorPage(key) {
	const d = D.find((x) => x.k === key);
	if (!d) { $("#app").innerHTML = `${chrome()}<main class="wrap"><p class="empty">Donor not found. <a href="#/money/donors">Back to donors</a></p></main>`; return; }
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<p><a href="#/money/donors">← All megadonors</a></p>
		<div class="section-title"><h2>${h(d.n)}</h2><span>${h(KIND[d.kind])} · ${h([d.city, d.st].filter(Boolean).join(", "))}</span></div>
		${d.emp || d.occ ? `<p class="lede">${h([d.emp, d.occ].filter(Boolean).join(" · "))}</p>` : ""}
		<div class="kv"><div><b>${money(d.total)}</b><span>Itemized gifts, 2025–26</span></div><div><b>${d.to.length}</b><span>Committees funded (top shown)</span></div></div>
		${d.kind === "organization" ? `<p class="note">Organizations can include 501(c)(4) nonprofits, which don't have to disclose their own donors, so the people behind this money may not be public.</p>` : ""}
		<div id="dchart" class="chartbox"></div>
		<h3>Committees funded, and where their money went</h3>
		<table class="t"><tr><th>Committee</th><th class="n">From this donor</th><th>Its top targets</th></tr>
		${d.to.map(([cid, v]) => { const c = M.committees[cid]; return `<tr><td>${c ? `<a href="#/money/c/${cid}">${h(c.n)}</a> <span class="tag">${h(c.t)}</span>` : h(cname(cid))}</td><td class="n">${money(v)}</td>
			<td class="note">${c ? c.rec.slice(0, 3).map(([pid, name, party, st, dd, s, o]) => `${o > dd + s ? "against " : ""}${pid ? `<a href="#/p/${h(pid)}">${h(S.byId.get(pid)?.name || name)}</a>` : h(name)} (${h(party)})`).join(", ") || "—" : "—"}</td></tr>`; }).join("")}</table>
	</main>${footer()}`;
	const nodes = [{ id: "me", name: d.n, kind: "donor" }], links = [], tg = new Map();
	for (const [cid, v] of d.to.slice(0, 10)) {
		const c = M.committees[cid];
		nodes.push({ id: "c" + cid, name: cname(cid), kind: c ? lean(c) : "node", href: c ? "#/money/c/" + cid : null });
		links.push({ source: "me", target: "c" + cid, value: v });
		if (!c) continue;
		for (const [pid, name, party, st, dd, s, o] of c.rec.slice(0, 5)) {
			const id = "t" + (pid || name);
			if (dd + s > 0) { if (!tg.has(id)) { tg.set(id, 1); nodes.push({ id, name: (pid && S.byId.get(pid)?.name) || name, kind: party || "mixed", href: pid ? "#/p/" + encodeURIComponent(pid) : null }); } links.push({ source: "c" + cid, target: id, value: dd + s }); }
			if (o > 0) { const oid = "x" + (pid || name); if (!tg.has(oid)) { tg.set(oid, 1); nodes.push({ id: oid, name: `Against ${(pid && S.byId.get(pid)?.name) || name}`, kind: "against" }); } links.push({ source: "c" + cid, target: oid, value: o, color: COLOR.against }); }
		}
	}
	sankey($("#dchart"), nodes, links, { label: `Where ${d.n}'s money went` });
}

// ------------------------------------------------------------------ profile: alignment, money web, voting record
const LEVEL = { low: ["Low", "var(--s-supports)"], moderate: ["Moderate", "var(--s-public_option)"], high: ["High", "var(--s-opposes)"], very_high: ["Very high", "var(--s-opposes)"] };
export function alignmentBox(f) {
	const a = f?.alignment;
	if (!a) return "";
	const [label, color] = LEVEL[a.level];
	const ch = a.chamber === "senate" ? "senators" : "House members";
	const why = a.anti / a.cast >= 0.5
		? `Voted against coverage on ${a.anti} of ${a.cast} key health votes, and took ${money(a.money)} from the health industry, more than ${a.pct}% of ${ch} who voted on them.`
		: `Voted for coverage on most key health votes (${a.cast - a.anti} of ${a.cast}), so the money and the votes don't line up${a.money ? `, despite ${money(a.money)} from the health industry` : ""}.`;
	return `<div class="stance-box" style="--stance:${color}"><div class="lbl">Health-industry money–vote alignment</div>
		<div class="val">${label}</div><p>${h(why)}</p>
		<p class="note">This shows where industry money and votes line up. It is a correlation, not proof of motive: members can vote the way donors want for their own reasons, and donors often give to people who already agree with them. Money counts health-industry PACs (campaign and leadership PAC) and employees' gifts.</p></div>`;
}

export async function moneyWeb(el, p, f) {
	if (!f?.has_data && !(f?.outside?.top || []).length) { el.innerHTML = ""; return; }
	try { await loadMoney(); } catch { el.innerHTML = ""; return; }
	const nodes = [{ id: "me", name: p.name, kind: p.party }], links = [], seen = new Set();
	const addN = (id, o) => { if (!seen.has(id)) { seen.add(id); nodes.push({ id, ...o }); } };
	(f.top_pacs || []).slice(0, 6).forEach((x) => { addN("p" + x.id, { name: x.name, kind: x.sector ? "against" : "node", href: M.committees[x.id] ? "#/money/c/" + x.id : null }); links.push({ source: "p" + x.id, target: "me", value: x.amount, note: "direct gift" }); });
	(f.leadership || []).forEach((l) => (l.top || []).slice(0, 4).forEach((x) => { addN("p" + x.id, { name: x.name, kind: x.sector ? "against" : "node", href: M.committees[x.id] ? "#/money/c/" + x.id : null }); links.push({ source: "p" + x.id, target: "me", value: x.amount, note: "to their leadership PAC" }); }));
	const sup = (f.outside?.top || []).filter((x) => x.support > 0).slice(0, 5);
	for (const x of sup) {
		const c = M.committees[x.id];
		addN("s" + x.id, { name: x.name, kind: c ? lean(c) : "mixed", href: c ? "#/money/c/" + x.id : null });
		links.push({ source: "s" + x.id, target: "me", value: x.support, note: "ads supporting them" });
		if (!c) continue;
		// A super PAC spends on many races, so attribute each funder's money in proportion to the share of
		// the super PAC's spending that went to this member (otherwise a $200M gift dwarfs a $9M ad buy).
		const share = Math.min(1, x.support / Math.max(c.x + c.g, x.support, 1));
		const pct = Math.round(share * 100);
		c.donors.slice(0, 3).forEach(([n, k, v, key]) => { addN("d" + key, { name: n, kind: "donor", href: D.some((d) => d.k === key) ? "#/money/d/" + encodeURIComponent(key) : null }); links.push({ source: "d" + key, target: "s" + x.id, value: v * share, note: `${pct}% share of ${money(v)} given` }); });
		c.from.slice(0, 2).forEach(([id, v]) => { addN("f" + id, { name: cname(id), kind: M.committees[id] ? lean(M.committees[id]) : "node", href: M.committees[id] ? "#/money/c/" + id : null }); links.push({ source: "f" + id, target: "s" + x.id, value: v * share, note: `${pct}% share of ${money(v)} given` }); });
	}
	const opp = (f.outside?.top || []).filter((x) => x.oppose > 0).slice(0, 6);
	el.innerHTML = `<h3>Money web <small>who funds the groups behind them</small></h3><div class="chartbox" id="pweb"></div>
		<p class="note">Left: big donors and committees funding the super PACs that ran ads for ${h(p.name)}, sized by their proportional share of what each super PAC spent on this race (hover for the full gift). Middle: those super PACs, plus PACs that gave directly (red = health industry). Click any name to follow it.</p>
		${opp.length ? `<p class="note"><b>Spent against them:</b> ${opp.map((x) => `${M.committees[x.id] ? `<a href="#/money/c/${x.id}">${h(x.name)}</a>` : h(x.name)} (${short(x.oppose)})`).join(", ")}</p>` : ""}`;
	sankey($("#pweb"), nodes, links, { height: 380, label: `Money web for ${p.name}` });
}

let V = {};
async function loadVotes(ch) { V[ch] ??= fetch(`/votes/${ch}.json`).then((r) => r.json()); return V[ch]; }
const VL = { Y: ["Yes", "yes"], N: ["No", "no"], P: ["Present", "pres"], "-": ["Didn't vote", "nv"] };
const TOPICS = ["health", "budget", "taxes", "immigration", "military", "energy", "labor", "guns", "civil rights", "nominations"];

export async function votingRecord(el, p) {
	const [hs, ss] = await Promise.all([loadVotes("house"), loadVotes("senate")]).catch(() => [null, null]);
	const sets = [["house", hs], ["senate", ss]].filter(([, d]) => d?.members?.[p.id]);
	if (!sets.length) { el.innerHTML = `<h3>Full voting record</h3><p class="note">${p.status === "incoming" ? "New in January 2027: no votes in Congress yet." : "No recorded votes in the current Congress."}</p>`; return; }
	const all = [];
	for (const [ch, d] of sets) {
		const s = d.members[p.id];
		d.rolls.forEach((r, i) => { const v = s[i]; if (v && v !== " ") all.push({ ch, r, v }); });
	}
	const party = p.party === "D" ? 10 : p.party === "R" ? 11 : -1;
	const cast = all.filter((x) => x.v === "Y" || x.v === "N");
	const missed = all.filter((x) => x.v === "-").length;
	const against = party > 0 ? cast.filter((x) => x.r[party] && x.r[party] !== x.v) : [];
	const st = { q: "", topic: "", only: "" };
	const draw = () => {
		const q = st.q.toLowerCase();
		const rows = all.filter((x) => (!st.topic || x.r[8].includes(st.topic)) && (!q || `${x.r[2]} ${x.r[3]} ${x.r[4]}`.toLowerCase().includes(q))
			&& (!st.only || (st.only === "against" ? party > 0 && x.r[party] && (x.v === "Y" || x.v === "N") && x.r[party] !== x.v : x.v === st.only))).reverse();
		el.querySelector(".vrows").innerHTML = rows.slice(0, 200).map((x) => `<tr><td class="note">${h(x.r[1])}<br>${x.ch === "senate" ? "Senate" : "House"}</td>
			<td><a href="${url(x.r[9])}" target="_blank" rel="noopener">${h(x.r[2] || "Vote")}</a> ${h(x.r[4] || "")}<br><span class="note">${h(x.r[3])} · ${h(x.r[5])} ${x.r[6]}–${x.r[7]}</span></td>
			<td><span class="vchip ${VL[x.v][1]}">${VL[x.v][0]}</span>${party > 0 && x.r[party] && (x.v === "Y" || x.v === "N") && x.r[party] !== x.v ? `<br><span class="note">against party</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" class="note">No votes match.</td></tr>`;
		el.querySelector(".vcount").textContent = `${rows.length} vote${rows.length === 1 ? "" : "s"}${rows.length > 200 ? " (showing the latest 200)" : ""}`;
	};
	el.innerHTML = `<h3>Full voting record <small>119th Congress</small></h3>
		<div class="kv"><div><b>${all.length}</b><span>Roll calls</span></div><div><b>${cast.filter((x) => x.v === "Y").length}</b><span>Yes</span></div><div><b>${cast.filter((x) => x.v === "N").length}</b><span>No</span></div>
			<div><b>${all.length ? Math.round((100 * missed) / all.length) : 0}%</b><span>Missed</span></div>${party > 0 ? `<div><b>${against.length}</b><span>Against own party</span></div>` : ""}</div>
		<div class="filters" style="position:static;padding:8px 0"><input type="search" class="vq" placeholder="Search bills or descriptions">
			<select class="vt"><option value="">All topics</option>${TOPICS.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select>
			<select class="vo"><option value="">All votes</option><option value="Y">Only Yes</option><option value="N">Only No</option><option value="-">Missed</option>${party > 0 ? `<option value="against">Against own party</option>` : ""}</select>
			<span class="note vcount"></span></div>
		<div class="tablewrap vbox"><table class="t"><tbody class="vrows"></tbody></table></div>
		<p class="note">Every recorded roll call from <a href="https://voteview.com" target="_blank" rel="noopener">Voteview</a>; each bill links to the official roll call. Topics are tagged by keyword, so check the bill before citing a vote.</p>`;
	el.querySelector(".vq").addEventListener("input", (e) => { st.q = e.target.value; draw(); });
	el.querySelector(".vt").addEventListener("change", (e) => { st.topic = e.target.value; draw(); });
	el.querySelector(".vo").addEventListener("change", (e) => { st.only = e.target.value; draw(); });
	draw();
}

export function bindMoney() {
	document.addEventListener("click", (e) => {
		const t = e.target.closest("[data-mtab]");
		if (t) location.hash = "#/money/" + t.dataset.mtab;
	});
	document.addEventListener("change", (e) => {
		const t = e.target;
		if (t.dataset.flow) { S.flow[t.dataset.flow] = t.dataset.flow === "n" ? Number(t.value) : t.value; loadMoney().then(flow); }
		if (t.id === "mt") { S.mt = t.value; loadMoney().then(matrix); }
		if (t.id === "dk") { S.dk = t.value; loadMoney().then(donorList); }
	});
	document.addEventListener("input", (e) => {
		if (e.target.id === "mq") { S.mq = e.target.value; clearTimeout(bindMoney.t); bindMoney.t = setTimeout(() => loadMoney().then(matrix).then(() => { const i = $("#mq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); }
		if (e.target.id === "dq") { S.dq = e.target.value; clearTimeout(bindMoney.t); bindMoney.t = setTimeout(() => loadMoney().then(donorList).then(() => { const i = $("#dq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); }
	});
}
