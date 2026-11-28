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

// Career pro-Israel PAC money (scripts/israel_career.py): {for, vs_opponents, against, first_cycle, aipac:{...}, pacs}.
export const careerOf = (p) => parse(p?.israel_career, null);
const aipacPart = (a) => (a ? (a.direct || 0) + (a.earmarked || 0) + (a.ie_for || 0) : 0);

// One line for cards: career money from AIPAC and other pro-Israel PACs (with AIPAC's share), outside spending
// against their opponents and against them, or none. Members of Congress only: these committees fund federal races.
export const trackOf = (p) => parse(p?.trackaipac, null);

export function aipacLine(p, fmt = money, { compact = false } = {}) {
	if (p?.chamber !== "house" && p?.chamber !== "senate") return "";
	// Track AIPAC's published total is the headline figure; our own FEC count is the fallback.
	const t = trackOf(p);
	if (t?.status === "funded" && t.total > 0) return `Israel lobby total: ${fmt(t.total)} (Track AIPAC)`;
	if (t?.status === "rejects") return "Rejects AIPAC money (Track AIPAC)";
	if (t?.status === "none") return "No pro-Israel PAC money (Track AIPAC)";
	const c = careerOf(p) || {}, ai = aipacPart(c.aipac), out = [];
	if (c.for > 0) out.push(`${fmt(c.for)} from AIPAC and other pro-Israel PACs since ${c.first_cycle - 1}${ai > 0 && !compact ? ` (AIPAC ${fmt(ai)})` : ""}`);
	if (c.vs_opponents > 0) out.push(`${fmt(c.vs_opponents)} spent against their opponents`);
	if (c.against > 0) out.push(`${fmt(c.against)} spent against them`);
	return out.join(" · ") || "No AIPAC or pro-Israel PAC money on record";
}

// Highlights (admin: Site look → Highlights): what profiles and cards call out besides Medicare for All.
// Same rules as highlightList() in src/index.ts, which draws them on share cards.
let stanceIndex = null;
const stanceFor = (pid, policy) => {
	if (!stanceIndex || stanceIndex.src !== S.data.positions) {
		stanceIndex = { src: S.data.positions, map: new Map() };
		for (const x of S.data.positions) stanceIndex.map.set(x.politician_id + "|" + x.policy_id, x.stance);
	}
	return stanceIndex.map.get(pid + "|" + policy) || "unknown";
};
export function highlightsOf(p, fmt = money) {
	const hl = S.data?.look?.highlights || { policies: [], money: ["pro_israel", "ai"] }, out = [];
	for (const id of (hl.policies || []).filter((x) => x !== "m4a")) {
		const pl = S.data.policies.find((x) => x.id === id);
		if (pl) { const st = stanceFor(p.id, id); out.push({ key: id, label: pl.name, value: STANCE[st], tone: st }); }
	}
	if (p.chamber !== "house" && p.chamber !== "senate") return out;
	if (hl.money?.includes("pro_israel")) {
		const t = trackOf(p), c = careerOf(p);
		out.push(t?.status === "funded" && t.total > 0 ? { key: "pro_israel", label: "Israel lobby money", value: fmt(t.total), tone: "paid" }
			: t?.status === "rejects" ? { key: "pro_israel", label: "Israel lobby money", value: "Rejects AIPAC", tone: "clean" }
			: !t && c?.for > 0 ? { key: "pro_israel", label: "Israel lobby money", value: fmt(c.for), tone: "paid" }
			: { key: "pro_israel", label: "Israel lobby money", value: "None", tone: "clean" });
	}
	if (hl.money?.includes("ai")) {
		const amt = Number(p.ai_money) || 0;
		out.push({ key: "ai", label: "AI and data center money", value: amt > 0 ? fmt(amt) : "None", tone: amt > 0 ? "paid" : "clean" });
	}
	return out;
}
export const highlightChips = (p, fmt = money) => highlightsOf(p, fmt).map((x) =>
	`<span class="hl hl-${h(x.tone)}"${x.key === "pro_israel" ? ' data-jump="aipac" role="button" tabindex="0" title="Jump to the AIPAC breakdown"' : ""}><small>${h(x.label)}</small><b>${h(x.value)}</b></span>`).join("");

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
		${(() => { const c = highlightChips(p, short); return c ? `<div class="hc-hl">${c}</div>` : ""; })()}
		${!highlightsOf(p).some((x) => x.key === "pro_israel") && aipacLine(p) ? `<div class="hc-line">${h(aipacLine(p, short))}</div>` : ""}
		${p.align && p.align !== "low" ? `<div class="hc-line">Health money–vote alignment: <b>${h(LEVEL[p.align])}</b></div>` : ""}
		<div class="hc-foot">Click for the full profile</div>`;
}

// ---------------------------------------------------------------- profile sections
const FEC_CMTE = (id) => `https://www.fec.gov/data/committee/${id}/`;

function careerBlock(c) {
	if (!c) return `<p class="note">No money from AIPAC or the other pro-Israel PACs on Track AIPAC's list in any FEC record since 1980.</p>`;
	const ai = c.aipac || {}, cell = (v) => (v ? money(v) : "—");
	return `<div class="kv"><div><b>${money(c.for)}</b><span>For them since ${c.first_cycle - 1}: gifts, routed donations and ads</span></div>
			<div><b>${money(aipacPart(ai))}</b><span>Of that, from AIPAC and its super PAC</span></div>
			${c.vs_opponents ? `<div><b>${money(c.vs_opponents)}</b><span>Spent against their opponents</span></div>` : ""}
			${c.against ? `<div><b>${money(c.against)}</b><span>Spent against them</span></div>` : ""}</div>
		<table class="t"><tr><th>Committee</th><th class="n">Gifts</th><th class="n">Routed donations</th><th class="n">Ads for them</th><th class="n">Ads vs. opponents</th><th class="n">Ads against them</th></tr>
		${(c.pacs || []).map((r) => `<tr><td><a href="${FEC_CMTE(h(r.id))}" target="_blank" rel="noopener">${h(r.name)}</a></td><td class="n">${cell(r.direct)}</td><td class="n">${cell(r.earmarked)}</td><td class="n">${cell(r.ie_for)}</td><td class="n">${cell(r.vs_opponents)}</td><td class="n">${cell(r.against ?? r.ie_against)}</td></tr>`).join("")}</table>`;
}

export function israelSection(f) {
	const x = f?.israel || {}, c = x.career, a = x.aipac, t = x.trackaipac;
	const ta = !t ? "" : `<div class="kv"><div><b>${t.status === "funded" ? money(t.total) : t.status === "rejects" ? "Rejects AIPAC" : "$0"}</b>
		<span>Israel lobby total, career, from <a href="${url(t.url)}" target="_blank" rel="noopener">Track AIPAC ↗</a>${t.as_of ? ` (as of ${h(t.as_of)})` : ""}</span></div></div>`;
	const head = `<h3 id="aipac">AIPAC and pro-Israel PACs</h3>${ta}<h4 class="mini">Our count from FEC filings, every cycle since 1980</h4>${careerBlock(c)}`;
	const note = `<p class="note">Counts the 66 committees on <a href="https://www.trackaipac.com/about/aipac" target="_blank" rel="noopener">Track AIPAC's list</a>, from FEC filings: gifts to their campaigns, donations people routed through these PACs (counted from 2021 on, when the AIPAC PAC opened, plus any a PAC reported itself earlier), and outside spending such as ads. "Against their opponents" is outside spending against other candidates for the same seat in the same election. "AIPAC" means only the AIPAC PAC and its super PAC, United Democracy Project; the other committees are separate organizations, listed by name. The headline figure is Track AIPAC's published total; our FEC count can differ, because routed donations before 2021 are only partly in the FEC's bulk files and Track AIPAC matches outside spending to races its own way.</p>`;
	if (!a) return head + note;
	const rows = [
		["AIPAC PAC, direct gifts", a.direct, 0, "C00797670"],
		[`Donations routed through AIPAC's PAC${a.earmarked_count ? ` (${a.earmarked_count} gifts)` : ""}`, a.earmarked, 0, "C00797670"],
		["United Democracy Project (AIPAC's super PAC), ads", a.udp_support, a.udp_oppose, "C00799031"],
		...(x.other || []).map((o) => [o.name, o.amount, 0, o.id]),
		...(x.other_outside || []).map((o) => [`${o.name}, ads`, o.support, o.oppose, o.id]),
	].filter((r) => r[1] > 0 || r[2] > 0);
	return head + `<h4 class="mini">This election cycle, 2025-26</h4>
		<div class="kv"><div><b>${money(a.direct + a.earmarked + a.udp_support)}</b><span>From or spent for them by AIPAC</span></div>
			${a.udp_oppose ? `<div><b>${money(a.udp_oppose)}</b><span>Spent against them by AIPAC's super PAC</span></div>` : ""}
			<div><b>${money((x.for || 0) - (a.direct + a.earmarked + a.udp_support))}</b><span>Other pro-Israel PACs and groups</span></div></div>
		${rows.length ? `<table class="t"><tr><th>Committee</th><th class="n">For them</th><th class="n">Against</th></tr>${rows.map((r) => `<tr><td><a href="${FEC_CMTE(h(r[3]))}" target="_blank" rel="noopener">${h(r[0])}</a></td><td class="n">${r[1] ? money(r[1]) : "—"}</td><td class="n">${r[2] ? money(r[2]) : "—"}</td></tr>`).join("")}</table>` : ""}` + note;
}

const GROUP = new Proxy({ pharma: "Drugmakers", insurers: "Insurers and PBMs", hospitals: "Hospitals", pro_israel: "AIPAC and pro-Israel groups" },
	{ get: (t, k) => t[k] || S.data?.meta?.industry_labels?.[k] || k });
const LVL = { low: ["Low", "var(--s-supports)"], moderate: ["Moderate", "var(--s-public_option)"], high: ["High", "var(--s-opposes)"], very_high: ["Very high", "var(--s-opposes)"], none: ["—", "var(--s-unknown)"] };

export function matrixBox(f) {
	const m = f?.matrix;
	if (!m || !m.length) return "";
	const ch = m[0].chamber === "senate" ? "senators" : "House members";
	return `<h3>Money vs. votes <small>by industry</small></h3>
		<table class="t matrix"><tr><th>Industry</th><th class="n">Money</th><th class="n">vs. ${h(ch)}</th><th class="n">Voted their way</th><th>Alignment</th></tr>
		${m.map((r) => {
			const [lbl, color] = LVL[r.level] || LVL.none;
			const SV = S.data.meta?.sector_votes || {};
			const votes = r.votes.map(([id, vote]) => ({ ...(SV[id] || { title: id, date: "" }), vote: vote.replace("_", " ") })).map((v) => `<li><a href="${url(v.source_url)}" target="_blank" rel="noopener">${h(v.title)}</a> (${h(v.date)}): voted <b>${h(v.vote)}</b>; ${h(GROUP[r.sector])} wanted <b>${h(v.industry_side)}</b>${v.industry_source_url ? ` <a href="${url(v.industry_source_url)}" target="_blank" rel="noopener">why we say so ↗</a>` : ""}</li>`).join("");
			return `<tr><td>${h(GROUP[r.sector])}${votes ? `<details><summary>${r.votes.length} vote${r.votes.length === 1 ? "" : "s"}</summary><ul class="mvotes">${votes}</ul></details>` : ""}</td>
				<td class="n">${money(r.money)}</td><td class="n">${r.money > 0 ? `more than ${r.pct}%` : "—"}</td>
				<td class="n">${r.cast ? `${r.with} of ${r.cast}` : "no votes"}</td>
				<td>${r.level === "none" ? `<span class="note">${r.cast ? "Too few votes to rate" : "—"}</span>` : `<span class="lvl" style="--lvl:${color}">${h(lbl)}</span>`}</td></tr>`;
		}).join("")}</table>
		<p class="note">Each row puts an industry's money next to how this member voted on the bills that industry lobbied on (each vote links to where the industry stated its side). Alignment is high when the member took more of that industry's money than most of their chamber <i>and</i> voted its way on most of its votes. Industries are tagged from each PAC's name and sponsor in FEC filings; see <a href="#/influence">Money and votes</a> for every industry across Congress.</p>`;
}
