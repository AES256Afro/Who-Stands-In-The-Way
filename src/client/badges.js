// Caucus badges, AIPAC money badges, the hover card, and the money-vs-votes matrix on profiles.
import { S, h, url, money, short, seat, stanceOf, STANCE } from "./main.js";

export const CAUCUS = {
	m4a: ["Medicare for All Caucus", "M4A Caucus", "good"],
	cpc: ["Congressional Progressive Caucus", "Progressive Caucus", ""],
	dsa: ["Democratic Socialists of America", "DSA", ""],
	cbc: ["Congressional Black Caucus", "Black Caucus", ""],
	chc: ["Congressional Hispanic Caucus", "Hispanic Caucus", ""],
	capac: ["Congressional Asian Pacific American Caucus", "Asian Pacific American Caucus", ""],
	newdem: ["New Democrat Coalition", "New Democrats", ""],
	bluedog: ["Blue Dog Coalition", "Blue Dogs", ""],
	problemsolvers: ["Problem Solvers Caucus", "Problem Solvers", ""],
	rsc: ["Republican Study Committee", "Republican Study Cmte", ""],
	freedom: ["House Freedom Caucus", "Freedom Caucus", ""],
};
const ORDER = Object.keys(CAUCUS);
const cache = new WeakMap();
const parse = (x, d) => { if (x == null || x === "") return d; if (typeof x !== "string") return x; try { return JSON.parse(x); } catch { return d; } };

// p.caucuses is a JSON array of {k, basis?, role?, src?} (seeded from data/raw/research/caucuses.json).
export function caucusesOf(p) {
	if (!p) return [];
	if (cache.has(p)) return cache.get(p);
	const list = parse(p.caucuses, []).filter((c) => CAUCUS[c.k]).sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k));
	cache.set(p, list);
	return list;
}

export function caucusBadges(p, { links = false, max = 99 } = {}) {
	const list = caucusesOf(p);
	const tag = (c) => {
		const [full, sh, cls] = CAUCUS[c.k];
		const label = c.k === "dsa" ? (c.basis === "member" ? "DSA member" : "DSA-endorsed") : sh;
		const title = `${full}${c.role ? " · " + c.role : ""}${c.k === "dsa" ? (c.basis === "member" ? " (member)" : " (endorsed)") : ""}`;
		const inner = `${h(label)}${c.role && (links || /chair/i.test(c.role)) ? ` <small>${h(c.role)}</small>` : ""}`;
		return links && c.src ? `<a class="tag caucus ${cls}" href="${url(c.src)}" target="_blank" rel="noopener" title="${h(title)} · source">${inner}</a>`
			: `<span class="tag caucus ${cls}" title="${h(title)}">${inner}</span>`;
	};
	const shown = list.slice(0, max).map(tag).join("");
	return shown + (list.length > max ? `<span class="tag">+${list.length - max}</span>` : "");
}

// Bootstrap rows carry aipac (object), israel_for, israel_against.
export function aipacOf(p) {
	const a = parse(p?.aipac, null);
	if (!a) return null;
	const given = (a.direct || 0) + (a.earmarked || 0);
	return { ...a, given, helped: given + (a.udp_support || 0) };
}

// own: false leaves out the AIPAC tags, for places that show aipacLine() instead.
export function aipacBadge(p, { own = true } = {}) {
	const a = aipacOf(p);
	const out = [];
	if (own && a?.helped > 0) out.push(`<span class="tag aipac" title="AIPAC PAC direct gifts, donations routed through AIPAC's PAC, and its super PAC United Democracy Project's ads for them (FEC, 2025–26)">AIPAC ${short(a.helped)}</span>`);
	if (own && a?.udp_oppose > 0) out.push(`<span class="tag aipac-against" title="AIPAC's super PAC United Democracy Project spent this on ads against them (FEC, 2025–26)">AIPAC spent ${short(a.udp_oppose)} against</span>`);
	const other = (p.israel_for || 0) - (a?.helped || 0);
	if (other >= 1000) out.push(`<span class="tag" title="Other pro-Israel PACs and groups (not AIPAC): direct gifts, routed donations and ads for them">Other pro-Israel ${short(other)}</span>`);
	return out.join("");
}

// One line for cards: what AIPAC gave or spent for them, what its super PAC spent against them, or none.
// Members of Congress only; AIPAC's committees are federal and don't fund state races.
export function aipacLine(p, fmt = money) {
	if (p?.chamber !== "house" && p?.chamber !== "senate") return "";
	const a = aipacOf(p) || { helped: 0, udp_support: 0, udp_oppose: 0 };
	const out = [];
	if (a.helped > 0) out.push(`${fmt(a.helped)} from AIPAC${a.udp_support > 0 ? " and its super PAC" : ""}`);
	if (a.udp_oppose > 0) out.push(`${fmt(a.udp_oppose)} spent against them by AIPAC's super PAC`);
	return out.join(" · ") || "No AIPAC money";
}

const LEVEL = { low: "Low", moderate: "Moderate", high: "High", very_high: "Very high" };

export function hoverCard(p) {
	const st = stanceOf(p.id);
	const badges = caucusBadges(p, { max: 4 });
	const aipac = aipacBadge(p, { own: !aipacLine(p) });
	const money_ = [p.health_total > 0 ? `${short(p.health_total)} health-industry PACs` : "", p.health_emp > 0 ? `${short(p.health_emp)} health-industry employees` : ""].filter(Boolean).join(" · ");
	return `<div class="hc-stance" style="--stance:var(--s-${st})"><span>Medicare for All</span><b>${h(STANCE[st])}</b></div>
		<div class="hc-name"><b>${h(p.name)}</b> <span>${h(p.party)}-${h(seat(p))}</span></div>
		${badges ? `<div class="hc-tags">${badges}</div>` : ""}
		${aipac ? `<div class="hc-tags">${aipac}</div>` : ""}
		${money_ ? `<div class="hc-line">${money_}</div>` : ""}
		${aipacLine(p) ? `<div class="hc-line">${h(aipacLine(p, short))}</div>` : ""}
		${p.align && p.align !== "low" ? `<div class="hc-line">Health money–vote alignment: <b>${h(LEVEL[p.align])}</b></div>` : ""}
		<div class="hc-foot">Click for the full profile</div>`;
}

// ---------------------------------------------------------------- profile sections
export function israelSection(f) {
	const x = f?.israel;
	if (!x) return `<h3 id="aipac">AIPAC and pro-Israel groups</h3><p class="note">No money from AIPAC, its super PAC or other pro-Israel PACs found for this cycle.</p>`;
	const a = x.aipac;
	const fec = (id) => `https://www.fec.gov/data/committee/${id}/`;
	const rows = [
		["AIPAC PAC, direct gifts", a.direct, 0, "C00797670"],
		[`Donations routed through AIPAC's PAC${a.earmarked_count ? ` (${a.earmarked_count} gifts)` : ""}`, a.earmarked, 0, "C00797670"],
		["United Democracy Project (AIPAC's super PAC), ads", a.udp_support, a.udp_oppose, "C00799031"],
		...x.other.map((o) => [o.name, o.amount, 0, o.id]),
		...x.other_outside.map((o) => [`${o.name}, ads`, o.support, o.oppose, o.id]),
	].filter((r) => r[1] > 0 || r[2] > 0);
	return `<h3 id="aipac">AIPAC and pro-Israel groups <small>FEC, 2025–26</small></h3>
		<div class="kv"><div><b>${money(a.direct + a.earmarked + a.udp_support)}</b><span>From or spent for them by AIPAC</span></div>
			${a.udp_oppose ? `<div><b>${money(a.udp_oppose)}</b><span>Spent against them by AIPAC's super PAC</span></div>` : ""}
			<div><b>${money(x.for - (a.direct + a.earmarked + a.udp_support))}</b><span>Other pro-Israel PACs and groups</span></div></div>
		<table class="t"><tr><th>Committee</th><th class="n">For them</th><th class="n">Against</th></tr>${rows.map((r) => `<tr><td><a href="${fec(h(r[3]))}" target="_blank" rel="noopener">${h(r[0])}</a></td><td class="n">${r[1] ? money(r[1]) : "—"}</td><td class="n">${r[2] ? money(r[2]) : "—"}</td></tr>`).join("")}</table>
		<p class="note">"AIPAC" counts only committees the FEC ties to AIPAC by name: the AIPAC PAC, donations individuals sent through it (the PAC passes them on, like a bundler), and its super PAC United Democracy Project. Other pro-Israel PACs are separate organizations, listed by name. Routed donations are counted from the candidate's own FEC reports.</p>`;
}

const GROUP = { pharma: "Drugmakers", insurers: "Insurers and PBMs", hospitals: "Hospitals", pro_israel: "AIPAC and pro-Israel groups" };
const LVL = { low: ["Low", "var(--s-supports)"], moderate: ["Moderate", "var(--s-public_option)"], high: ["High", "var(--s-opposes)"], very_high: ["Very high", "var(--s-opposes)"], none: ["—", "var(--s-unknown)"] };

export function matrixBox(f) {
	const m = f?.matrix;
	if (!m || !m.length) return "";
	const ch = m[0].chamber === "senate" ? "senators" : "House members";
	return `<h3>Money vs. votes <small>by donor group</small></h3>
		<table class="t matrix"><tr><th>Donor group</th><th class="n">Money</th><th class="n">vs. ${h(ch)}</th><th class="n">Voted their way</th><th>Alignment</th></tr>
		${m.map((r) => {
			const [lbl, color] = LVL[r.level] || LVL.none;
			const SV = S.data.meta?.sector_votes || {};
			const votes = r.votes.map(([id, vote]) => ({ ...(SV[id] || { title: id, date: "" }), vote: vote.replace("_", " ") })).map((v) => `<li><a href="${url(v.source_url)}" target="_blank" rel="noopener">${h(v.title)}</a> (${h(v.date)}): voted <b>${h(v.vote)}</b>; ${h(GROUP[r.sector])} wanted <b>${h(v.industry_side)}</b>${v.industry_source_url ? ` <a href="${url(v.industry_source_url)}" target="_blank" rel="noopener">why we say so ↗</a>` : ""}</li>`).join("");
			return `<tr><td>${h(GROUP[r.sector])}${votes ? `<details><summary>${r.votes.length} vote${r.votes.length === 1 ? "" : "s"}</summary><ul class="mvotes">${votes}</ul></details>` : ""}</td>
				<td class="n">${money(r.money)}</td><td class="n">${r.money > 0 ? `more than ${r.pct}%` : "—"}</td>
				<td class="n">${r.cast ? `${r.with} of ${r.cast}` : "no votes"}</td>
				<td>${r.level === "none" ? `<span class="note">${r.cast ? "Too few votes to rate" : "—"}</span>` : `<span class="lvl" style="--lvl:${color}">${h(lbl)}</span>`}</td></tr>`;
		}).join("")}</table>
		<p class="note">Each row puts a donor group's money next to how this member voted on bills that group publicly lobbied on (each vote links to where the group stated its side). Alignment is high only when the member took more of that group's money than most of their chamber <i>and</i> voted the group's way on most of its votes. This is a correlation, not proof of motive: members can vote the way donors want for their own reasons, and donors often give to people who already agree with them.</p>`;
}
