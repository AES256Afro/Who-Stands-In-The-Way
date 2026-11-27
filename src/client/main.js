import { renderAdmin, adminProfileTools, bindAdmin } from "./admin.js";
import { shareButtons, bindShare } from "./share.js";
import { renderMoney, alignmentBox, moneyWeb, votingRecord, bindMoney } from "./money.js";
import { mapHtml, stateHtml, renderIssues, renderElections, issueMatrix, leanBox, LEAN, bindViews, zipBox, renderZip, bindZip, votesBox, renderVotes, voteScore } from "./views.js";

export const STANCE = {
	supports: "Supports",
	public_option: "Public option only",
	unclear: "Wishy-washy",
	opposes: "Opposes",
	unknown: "Not on record",
};
export const STANCE_ORDER = ["supports", "public_option", "unclear", "unknown", "opposes"];
export const KIND = {
	show: "TV / show / podcast",
	quote: "Quote or statement",
	vote: "Vote",
	post: "Social media post",
	speech: "Speech or town hall",
	article: "Article or interview",
	other: "Other",
};
export const SIGNAL = {
	supported: ["Voiced support", "supports"],
	public_option: ["Pushed public option", "public_option"],
	hedged: ["Hedged", "unclear"],
	dodged: ["Dodged the question", "unknown"],
	opposed: ["Opposed", "opposes"],
};
export const PARTY = { D: "Democrat", R: "Republican", I: "Independent" };
const SECTOR = { pharma: "Pharma", insurance: "Insurance", hospitals: "Hospitals", devices: "Medical devices", providers: "Care providers", doctors: "Doctors' groups" };
export const tel = (n) => "tel:+1" + String(n || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export const callBtn = (p, cls = "btn small") => (p.phone ? `<a class="${cls} call" href="${tel(p.phone)}" title="${h(p.phone_label || "Office phone")}">📞 ${h(p.phone)}</a>` : "");

export const S = {
	data: null, admin: false, configured: true, policy: null, pos: new Map(),
	f: { q: "", chamber: "", party: "", stance: "", state: "", sort: "name", health: false, cohort: "", lean: "" },
	congress: null, byId: new Map(), mapMode: "party", mapState: "",
	adminTab: "appearance",
};
const $ = (s, el = document) => el.querySelector(s);
export const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const url = (u) => (/^https?:\/\//i.test(u || "") ? h(u) : "#");
export const money = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
export const short = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "k" : "$" + Math.round(n || 0));
export const seat = (p) => (p.chamber === "executive" ? p.role : `${p.state}${p.chamber === "house" && p.district ? "-" + p.district : p.chamber === "house" ? "-AL" : ""}`);
export const year = (d) => (d ? d.slice(0, 4) : "");
export const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export async function api(path, opts = {}) {
	const res = await fetch("/api/" + path, {
		method: opts.method || "GET",
		headers: opts.body ? { "content-type": "application/json" } : undefined,
		body: opts.body ? JSON.stringify(opts.body) : undefined,
		credentials: "same-origin",
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || "Request failed");
	return data;
}
export function toast(msg, err) {
	const t = $("#toast");
	t.textContent = msg;
	t.className = "toast" + (err ? " err" : "");
	t.hidden = false;
	clearTimeout(toast.t);
	toast.t = setTimeout(() => (t.hidden = true), 2600);
}

export async function load() {
	const [data, me] = await Promise.all([api("bootstrap"), api("me")]);
	data.all = data.politicians.filter((p) => p.status !== "former");
	S.byId = new Map(data.all.map((p) => [p.id, p]));
	S.data = data;
	S.congress ??= data.meta?.default_congress || 120;
	applyCongress();
	S.admin = me.admin;
	S.configured = me.configured;
	if (!S.policy || !data.policies.some((p) => p.id === S.policy)) S.policy = data.policies[0]?.id;
	indexPositions();
}
// Members of the selected Congress. 120th: everyone with a 120th term (plus people added by hand, who have no
// terms). 119th: the term rows, with chamber/seat/party as they were in that Congress.
export function applyCongress() {
	const d = S.data, terms = d.terms || [];
	const any = new Set(terms.map((t) => t.politician_id));
	const inC = terms.filter((t) => t.congress === S.congress);
	if (S.congress === 120 || !inC.length) {
		const has = new Set(inC.map((t) => t.politician_id));
		d.politicians = d.all.filter((p) => p.status !== "departing" && (has.has(p.id) || !any.has(p.id)));
	} else {
		d.politicians = inC.filter((t) => S.byId.has(t.politician_id)).map((t) => ({ ...S.byId.get(t.politician_id),
			chamber: t.chamber, state: t.state, district: t.district, party: t.party, voting: t.voting, role: t.role }));
	}
}
export const isNext = () => S.congress === (S.data.meta?.default_congress || 120);
export const congressLabel = () => (S.data.meta?.congresses || []).find((c) => c.id === S.congress)?.label || "";
function indexPositions() {
	S.pos = new Map();
	for (const p of S.data.positions) if (p.policy_id === S.policy) S.pos.set(p.politician_id, p);
}
export const stanceOf = (id) => S.pos.get(id)?.stance || "unknown";
const policy = () => S.data.policies.find((p) => p.id === S.policy) || {};

// ------------------------------------------------------------------ charts
function hemicycle(members, rows, label) {
	const W = 600, H = 320, cx = W / 2, cy = H - 14, r0 = 96, r1 = 286;
	const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
	const sum = radii.reduce((a, b) => a + b, 0);
	const n = members.length;
	let counts = radii.map((r) => Math.round((n * r) / sum));
	let diff = n - counts.reduce((a, b) => a + b, 0);
	for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) { counts[i] += Math.sign(diff); diff -= Math.sign(diff); }
	const pts = [];
	radii.forEach((r, i) => {
		for (let k = 0; k < counts[i]; k++) {
			const a = counts[i] === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (counts[i] - 1);
			pts.push({ a, r, x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });
		}
	});
	pts.sort((p, q) => q.a - p.a || p.r - q.r);
	const dot = Math.min((r1 - r0) / (rows - 1), (Math.PI * r0) / Math.max(counts[0] - 1, 1)) * 0.43;
	const order = { D: 0, I: 1, R: 2 };
	const sorted = [...members].sort((a, b) =>
		STANCE_ORDER.indexOf(stanceOf(a.id)) - STANCE_ORDER.indexOf(stanceOf(b.id)) || (order[a.party] ?? 1) - (order[b.party] ?? 1) || a.last.localeCompare(b.last));
	const yes = members.filter((m) => stanceOf(m.id) === "supports").length;
	const circles = sorted.map((m, i) => {
		const p = pts[i];
		return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dot.toFixed(1)}" fill="var(--s-${stanceOf(m.id)})" data-id="${h(m.id)}"/>`;
	}).join("");
	return `<svg class="hemi" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(label)}: ${yes} of ${n} voting members support ${h(policy().name)}. Full list below.">
		${circles}
		<text class="big" x="${cx}" y="${cy - 26}" text-anchor="middle">${yes}</text>
		<text class="small" x="${cx}" y="${cy - 8}" text-anchor="middle">of ${n} support</text>
	</svg>`;
}

function meter(title, members, marks) {
	const n = members.length;
	const c = Object.fromEntries(STANCE_ORDER.map((s) => [s, 0]));
	members.forEach((m) => c[stanceOf(m.id)]++);
	const need = marks[0][0];
	const gap = Math.max(need - c.supports, 0);
	return `<div class="meter">
		<h3><b>${h(title)}</b><span>${c.supports} on record · ${gap ? `${gap} short of ${need}` : `clears ${need}`}</span></h3>
		<div class="bar">${STANCE_ORDER.filter((s) => c[s]).map((s) => `<i class="c-${s}" style="flex:${c[s]}" title="${h(STANCE[s])}: ${c[s]}"></i>`).join("")}
			${marks.map(([v, l], i) => `<span class="tick${marks.length > 1 ? (i ? " r" : " l") : ""}" style="left:${(v / n) * 100}%" data-label="${h(l)}"></span>`).join("")}
		</div></div>`;
}

const legend = () => `<div class="legend">${STANCE_ORDER.map((s) => `<span><i class="dot c-${s}"></i>${h(STANCE[s])}</span>`).join("")}</div>`;
export const pill = (s) => `<span class="pill"><i class="dot c-${s}"></i>${h(STANCE[s] || s)}</span>`;
export function avatar(p) {
	const init = h(((p.first || p.name || "?")[0] + (p.last || "")[0]).toUpperCase());
	return `<span class="avatar">${p.photo_url ? `<img src="${url(p.photo_url)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${init}'))">` : init}</span>`;
}

// ------------------------------------------------------------------ main view
function filtered() {
	const f = S.f, q = f.q.trim().toLowerCase();
	let rows = S.data.politicians.filter((p) =>
		(!q || `${p.name} ${p.state} ${seat(p)} ${p.twitter || ""}`.toLowerCase().includes(q)) &&
		(!f.chamber || p.chamber === f.chamber) && (!f.party || p.party === f.party) &&
		(!f.stance || stanceOf(p.id) === f.stance) && (!f.state || p.state === f.state) &&
		(!f.health || p.health_total > 0) && (!f.hcmte || p.health_cmte) &&
		(!f.lean || (p.lean || "unknown") === f.lean) &&
		(!f.cohort || (f.cohort === "new" ? p.status === "incoming" : f.cohort === "returning" ? p.status === "current"
			: f.cohort === "departing" ? p.status === "departing" : year(p.next_election) === f.cohort)));
	const by = {
		name: (a, b) => a.last.localeCompare(b.last),
		state: (a, b) => a.state.localeCompare(b.state) || (a.district || 0) - (b.district || 0),
		health: (a, b) => (b.health_total || 0) - (a.health_total || 0),
		healthemp: (a, b) => (b.health_emp || 0) - (a.health_emp || 0),
		votes: (a, b) => { const x = voteScore(a.id), y = voteScore(b.id); return (x ? x.pro / x.cast : 2) - (y ? y.pro / y.cast : 2) || a.last.localeCompare(b.last); },
		outside: (a, b) => (b.outside_support + b.outside_oppose) - (a.outside_support + a.outside_oppose),
		pacs: (a, b) => (b.pacs || 0) - (a.pacs || 0),
		election: (a, b) => (a.next_election || "9").localeCompare(b.next_election || "9") || a.last.localeCompare(b.last),
	}[f.sort];
	return rows.sort(by);
}
function listHtml() {
	const rows = filtered();
	const apps = new Map();
	for (const a of S.data.appearances) apps.set(a.politician_id, (apps.get(a.politician_id) || 0) + 1);
	$("#count").textContent = `${rows.length} of ${S.data.politicians.length}`;
	if (!rows.length) return `<p class="empty">Nobody matches those filters.</p>`;
	return rows.map((p) => {
		const st = stanceOf(p.id);
		const vs = S.f.sort === "votes" ? voteScore(p.id) : null;
		const extra = S.f.sort === "votes" ? (vs ? `protected coverage on ${vs.pro} of ${vs.cast} key votes` : "no key votes") : S.f.sort === "healthemp" ? `${short(p.health_emp || 0)} from health-industry employees` : S.f.sort === "outside" ? `${short(p.outside_support + p.outside_oppose)} outside $`
			: S.f.sort === "pacs" ? `${short(p.pacs || 0)} from PACs`
			: p.health_total > 0 ? `${short(p.health_total)} health-industry PACs` : "";
		return `<button class="row" style="--stance:var(--s-${st})" data-id="${h(p.id)}">
			${avatar(p)}
			<span><span class="name">${h(p.name)}</span><br><span class="meta"><span class="party ${h(p.party)}">${h(p.party)}</span> · ${h(seat(p))} · ${h(p.role)}${p.voting ? "" : p.chamber === "house" ? " (non-voting)" : ""}${p.status === "incoming" ? ` · <span class="tag new">New</span>` : ""}${p.status === "departing" ? ` · <span class="tag">Leaving</span>` : ""}${p.lean && p.lean !== "unknown" ? ` · <span class="tag lean" style="--lean:var(--l-${h(p.lean)})">${h(LEAN[p.lean])}</span>` : ""}</span></span>
			<span class="right">${pill(st)}<span>${p.next_election ? `Next election ${year(p.next_election)}` : ""}${extra ? " · " + h(extra) : ""}${apps.get(p.id) ? ` · ${apps.get(p.id)} clip${apps.get(p.id) > 1 ? "s" : ""}` : ""}</span></span>
		</button>`;
	}).join("");
}
export function appHtml(a, withName = true) {
	const p = S.byId.get(a.politician_id);
	const [sl, sc] = SIGNAL[a.signal] || [null, "unknown"];
	return `<div class="app">
		<time>${h(fmtDate(a.date))}</time>
		<div>
			<div class="t">${withName && p ? `<a href="#/p/${h(p.id)}">${h(p.name)}</a> — ` : ""}${h(a.title || KIND[a.kind] || "Appearance")}</div>
			${a.kind ? `<span class="tag">${h(KIND[a.kind] || a.kind)}</span> ` : ""}
			<span class="outlet">${a.outlet_logo ? `<img src="${url(a.outlet_logo)}" alt="">` : ""}${a.outlet_website ? `<a href="${url(a.outlet_website)}" target="_blank" rel="noopener">${h(a.outlet_name)}</a>` : h(a.outlet_name || "")}</span>
			${a.quote ? `<blockquote>${h(a.quote)}</blockquote>` : ""}
			${a.notes ? `<p class="note">${h(a.notes)}</p>` : ""}
		</div>
		<div class="links">${sl ? `<span class="pill"><i class="dot c-${sc}"></i>${h(sl)}</span>` : ""}
			${a.clip_url ? `<a class="btn small" href="${url(a.clip_url)}" target="_blank" rel="noopener">Source ↗</a>` : ""}
			${a.post_url ? `<a class="btn small primary" href="${url(a.post_url)}" target="_blank" rel="noopener">Our write-up ↗</a>` : ""}
			${S.admin ? `<button class="btn small danger" data-del="appearances" data-delid="${a.id}">Delete</button>` : ""}</div>
	</div>`;
}

function renderMain() {
	const d = S.data, pol = policy();
	const voting = d.politicians.filter((p) => p.voting && p.chamber !== "executive");
	const senate = voting.filter((p) => p.chamber === "senate"), house = voting.filter((p) => p.chamber === "house");
	const yes = voting.filter((p) => stanceOf(p.id) === "supports").length;
	const fresh = voting.filter((p) => p.status === "incoming");
	const freshYes = fresh.filter((p) => stanceOf(p.id) === "supports").length;
	const back = voting.filter((p) => p.status !== "incoming");
	const backYes = back.filter((p) => stanceOf(p.id) === "supports").length;
	const next = isNext();
	const open = next ? (d.meta?.undecided || []).length : 0;
	const leaving = voting.filter((p) => p.status === "departing");
	const elections = [...new Set(d.politicians.map((p) => year(p.next_election)).filter(Boolean))].sort();
	const exec = d.politicians.filter((p) => p.chamber === "executive");
	const states = [...new Set(d.politicians.map((p) => p.state))].sort();
	const opt = (v, l, cur) => `<option value="${h(v)}"${cur === v ? " selected" : ""}>${h(l)}</option>`;
	$("#app").innerHTML = `${chrome()}
	<main class="wrap">
		<div class="congress-switch" role="group" aria-label="Which Congress to show">
			${(d.meta?.congresses || []).map((c) => `<button type="button" data-congress="${c.id}" aria-pressed="${c.id === S.congress}">
				<b>${c.id === (d.meta?.default_congress || 120) ? "January 2027 Congress" : "Current Congress"}</b>
				<span>${c.id === (d.meta?.default_congress || 120) ? "120th · sworn in Jan 3, 2027" : "119th · leaves office Jan 3, 2027"}</span></button>`).join("")}
		</div>
		<section class="hero">
			<div>
				<div class="eyebrow">${d.policies.length > 1 ? `<select id="policy" aria-label="Policy">${d.policies.map((p) => opt(p.id, p.name, S.policy)).join("")}</select>` : h(pol.name)} · ${h([pol.bill_house, pol.bill_senate].filter(Boolean).join(" / "))}</div>
				<h1><em>${yes}</em> of ${voting.length} in the ${next ? "next" : "current"} Congress are on record for ${h(pol.name)}.</h1>
				<p>${h(pol.description || "")} Everyone else is standing in the way until they say otherwise.</p>
				${next ? `<div class="kv split">
					<div><b>${backYes} <small>of ${back.length}</small></b><span>Returning members on record</span></div>
					<div><b>${freshYes} <small>of ${fresh.length}</small></b><span>Newcomers on record</span></div>
					<div><b>${open}</b><span>House seat${open === 1 ? "" : "s"} still undecided${open ? ` (${h(d.meta.undecided.join(", "))})` : ""}</span></div>
				</div>` : `<div class="kv split">
					<div><b>${leaving.filter((p) => stanceOf(p.id) === "supports").length} <small>of ${leaving.length}</small></b><span>Leaving in January, on record</span></div>
					<div><b>${voting.length - leaving.length}</b><span>Staying for the next Congress</span></div>
				</div>`}
			</div>
			<div class="meters">
				${meter("House", house, [[Math.floor(house.length / 2) + 1, `${Math.floor(house.length / 2) + 1} to pass`]])}
				${meter("Senate", senate, [[51, "51 to pass"], [60, "60 to beat a filibuster"]])}
				${legend()}
			</div>
		</section>
		<section class="card zippage">${zipBox(true)}</section>
		<section class="card mapcard" id="map">${mapHtml()}</section>
		<div id="statepanel">${stateHtml()}</div>
		<section class="chambers">
			<div class="card"><h2>Senate</h2><p class="sub">${senate.length} seats${next ? " from Jan 3, 2027" : " now"} · each dot is a senator</p>${hemicycle(senate, 5, "Senate")}</div>
			<div class="card"><h2>House</h2><p class="sub">${house.length} of 435 voting seats ${next ? "decided" : "filled"} · hover or tap a dot</p>${hemicycle(house, 11, "House")}</div>
		</section>
		<div class="exec">${exec.map((p) => `<button class="row" style="--stance:var(--s-${stanceOf(p.id)})" data-id="${h(p.id)}">${avatar(p)}<span><span class="name">${h(p.name)}</span><br><span class="meta">${h(p.role)} · ${h(p.notes || "")}</span></span><span class="right">${pill(stanceOf(p.id))}</span></button>`).join("")}</div>
		${d.appearances.length ? `<div class="section-title"><h2>On the record</h2><span>Latest documented appearances</span></div>
			<div class="feed">${d.appearances.slice(0, 6).map((a) => appHtml(a)).join("")}</div>` : ""}
		<div class="section-title"><h2>Everyone with a vote or a veto</h2><span id="count"></span></div>
		<div class="filters">
			<input type="search" id="q" placeholder="Search by name, state or handle" value="${h(S.f.q)}" aria-label="Search">
			<select data-f="chamber" aria-label="Chamber">${opt("", "All chambers", S.f.chamber)}${opt("senate", "Senate", S.f.chamber)}${opt("house", "House", S.f.chamber)}${opt("executive", "Executive", S.f.chamber)}</select>
			<select data-f="stance" aria-label="Stance">${opt("", "Any stance", S.f.stance)}${STANCE_ORDER.map((s) => opt(s, STANCE[s], S.f.stance)).join("")}</select>
			<select data-f="party" aria-label="Party">${opt("", "Any party", S.f.party)}${Object.entries(PARTY).map(([k, v]) => opt(k, v, S.f.party)).join("")}</select>
			<select data-f="state" aria-label="State">${opt("", "All states", S.f.state)}${states.map((s) => opt(s, s, S.f.state)).join("")}</select>
			<select data-f="lean" aria-label="Lean">${opt("", "Any lean", S.f.lean)}${Object.entries(LEAN).map(([k, v]) => opt(k, v, S.f.lean)).join("")}</select>
			<select data-f="cohort" aria-label="Cohort">${opt("", next ? "New and returning" : "Everyone", S.f.cohort)}${next ? opt("new", "New in 2027", S.f.cohort) + opt("returning", "Returning", S.f.cohort) : opt("departing", "Leaving in January", S.f.cohort)}${elections.map((y) => opt(y, `Up for re-election in ${y}`, S.f.cohort)).join("")}</select>
			<select data-f="sort" aria-label="Sort">${opt("name", "Sort: name", S.f.sort)}${opt("election", "Sort: next election", S.f.sort)}${opt("state", "Sort: state", S.f.sort)}${opt("health", "Sort: health-industry PAC $", S.f.sort)}${opt("healthemp", "Sort: health-industry employee $", S.f.sort)}${opt("votes", "Sort: worst health voting record", S.f.sort)}${opt("pacs", "Sort: all PAC $", S.f.sort)}${opt("outside", "Sort: outside spending", S.f.sort)}</select>
			<label class="check"><input type="checkbox" id="health"${S.f.health ? " checked" : ""}> Takes health-industry PAC money</label>
			<label class="check"><input type="checkbox" id="hcmte"${S.f.hcmte ? " checked" : ""}> Sits on a health committee</label>
		</div>
		<div class="list" id="list"></div>
	</main>
	${footer()}`;
	$("#list").innerHTML = listHtml();
}
export const chromeOnly = () => chrome();
export const chrome = () => `${S.admin ? `<div class="adminbar"><div class="wrap"><span>Signed in as admin — edit controls are visible on every profile.</span><span><a href="#/admin">Admin panel</a> · <a href="#" data-logout>Sign out</a></span></div></div>` : ""}
	<div class="wrap"><header class="top"><a class="brand" href="#/">Who Stands <span>In The Way</span></a>
	<nav><a class="btn ghost" href="#/">Dashboard</a><a class="btn ghost" href="#/zip">Find your rep</a><a class="btn ghost" href="#/votes">Key votes</a><a class="btn ghost" href="#/money">Money</a><a class="btn ghost" href="#/issues">Issues</a><a class="btn ghost" href="#/elections">2026 results</a><a class="btn" href="#/admin">${S.admin ? "Admin panel" : "Admin"}</a></nav></header></div>`;
export const footer = () => `<footer><div class="wrap">Baseline: the Congress sworn in January 3, 2027, from <a href="${url(S.data.meta?.roster_source || "https://en.wikipedia.org/wiki/120th_United_States_Congress")}" target="_blank" rel="noopener">Wikipedia's 120th Congress roster</a> (checked against Wikidata); returning members' accounts from the <a href="https://github.com/unitedstates/congress-legislators" target="_blank" rel="noopener">congress-legislators</a> project; returning members' support = sponsors and cosponsors of the 119th Congress bill on <a href="https://www.congress.gov/bill/119th-congress/house-bill/3069" target="_blank" rel="noopener">congress.gov</a>; money from <a href="https://www.fec.gov/data/browse-data/?tab=bulk-data" target="_blank" rel="noopener">FEC bulk filings</a> (2025–26 cycle); lean starts from each member's voting record (<a href="https://voteview.com" target="_blank" rel="noopener">Voteview</a> DW-NOMINATE, 119th Congress) and can be overridden by hand; newcomers' stances researched from campaign statements in November 2026 and linked to their source. "Not on record" means not a cosponsor and nothing documented yet. Everything after the baseline is maintained by hand.</div></footer>`;

// ------------------------------------------------------------------ profile drawer
async function openProfile(id) {
	const dlg = $("#drawer");
	let d;
	try { d = await api("politicians/" + encodeURIComponent(id)); } catch (e) { toast(e.message, true); location.hash = "#/"; return; }
	const p = d.politician, f = d.finance;
	const pos = Object.fromEntries(d.positions.map((x) => [x.policy_id, x]));
	const link = (href, label) => (href ? `<a class="btn small" href="${url(href)}" target="_blank" rel="noopener">${h(label)} ↗</a>` : "");
	const tw = (handle, label) => (handle ? link("https://x.com/" + encodeURIComponent(handle), `${label} @${handle}`) : "");
	const alts = (p.twitter_alt || "").split(",").map((s) => s.trim()).filter(Boolean);
	const fec = (p.fec_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
	const parse = (x) => { try { return JSON.parse(x || "[]"); } catch { return []; } };
	const offices = parse(p.offices), cmtes = parse(p.committees);
	let moneyHtml = `<p class="note">No FEC filings matched for the 2025–26 cycle.</p>`;
	if (f?.has_data) {
		const t = f.totals;
		const other = Math.max(t.receipts - t.individuals - t.pacs - t.party - t.self, 0);
		const parts = [["Individuals", t.individuals, "ind"], ["PACs", t.pacs, "pac"], ["Party", t.party, "party"], ["Self-funded", t.self, "self"], ["Other / transfers", other, "other"]].filter((x) => x[1] > 0);
		moneyHtml = `<div class="kv">
				<div><b>${money(t.receipts)}</b><span>Raised, ${h(f.cycle)}</span></div>
				<div><b>${money(f.health_total + (f.leadership || []).reduce((a, l) => a + l.health_total, 0))}</b><span>Health-industry PACs (campaign + leadership PAC)</span></div>
				<div><b>${money(f.employees?.total || 0)}</b><span>Health-industry employees</span></div>
				<div><b>${money(f.outside.support)}</b><span>Outside $ supporting</span></div>
				<div><b>${money(f.outside.oppose)}</b><span>Outside $ opposing</span></div>
			</div>
			<div class="mbar" role="img" aria-label="Where the campaign's money came from">${parts.map((x) => `<i style="flex:${x[1]};background:var(--m-${x[2]})" title="${h(x[0])}: ${money(x[1])}"></i>`).join("")}</div>
			<div class="legend">${parts.map((x) => `<span><i class="dot" style="background:var(--m-${x[2]})"></i>${h(x[0])} ${money(x[1])}</span>`).join("")}</div>
			<p class="note">Direct money to the campaign committee, reported to the FEC through ${h(t.through)}. Limits apply: $5,000 per PAC per election.</p>
			${f.health_pacs.length ? `<h3>Health-industry PACs giving directly <small>${Object.entries(f.health_sectors).map(([k, v]) => `${SECTOR[k]} ${short(v)}`).join(" · ")}</small></h3>
				<table class="t"><tr><th>PAC</th><th>Sector</th><th class="n">Given</th></tr>${f.health_pacs.map((x) => `<tr><td><a href="https://www.fec.gov/data/committee/${h(x.id)}/" target="_blank" rel="noopener">${h(x.name)}</a></td><td><span class="tag">${h(SECTOR[x.sector])}</span></td><td class="n">${money(x.amount)}</td></tr>`).join("")}</table>` : `<p class="note">No direct gifts from pharma, insurer or hospital PACs found this cycle.</p>`}
			${f.top_pacs.length ? `<details class="admin"><summary>Top ${f.top_pacs.length} PAC donors overall (${f.pac_count} PACs gave ${money(f.pac_itemized_total)})</summary>
				<table class="t"><tr><th>PAC</th><th class="n">Given</th></tr>${f.top_pacs.map((x) => `<tr><td><a href="https://www.fec.gov/data/committee/${h(x.id)}/" target="_blank" rel="noopener">${h(x.name)}</a>${x.sector ? ` <span class="tag">${h(SECTOR[x.sector])}</span>` : ""}</td><td class="n">${money(x.amount)}</td></tr>`).join("")}</table></details>` : ""}
			${(() => {
				const e = f.employees;
				if (!e || !e.total) return `<h3>Donations from health-industry employees</h3><p class="note">No itemized donations found from employees of drugmakers, insurers, device makers or for-profit care chains this cycle.</p>`;
				return `<h3>Donations from health-industry employees <small>${e.donations} itemized gifts</small></h3>
				<div class="kv"><div><b>${money(e.total)}</b><span>From people working at health companies</span></div>
					${Object.entries(e.sectors).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><b>${money(v)}</b><span>${h(SECTOR[k] || k)}</span></div>`).join("")}</div>
				<table class="t"><tr><th>Employer (as reported)</th><th>Sector</th><th class="n">Gifts</th><th class="n">Total</th></tr>${e.top.map((x) => `<tr><td>${h(x.employer)}</td><td><span class="tag">${h(SECTOR[x.sector] || x.sector)}</span></td><td class="n">${x.count}</td><td class="n">${money(x.amount)}</td></tr>`).join("")}</table>
				<p class="note">Personal donations from employees of drugmakers, insurers and PBMs, device makers and for-profit care chains, grouped by the employer donors reported to the FEC. Only gifts over $200 are itemized. Nurses and nonprofit-hospital staff are left out. Shown as totals by employer, not by donor.</p>`;
			})()}
			<h3>Super PACs and outside groups <small>${f.outside.count} group${f.outside.count === 1 ? "" : "s"}</small></h3>
			${f.outside.top.length ? `<table class="t"><tr><th>Group</th><th>Type</th><th class="n">Spent for</th><th class="n">Spent against</th></tr>${f.outside.top.map((x) => `<tr><td><a href="https://www.fec.gov/data/committee/${h(x.id)}/" target="_blank" rel="noopener">${h(x.name)}</a>${x.sector ? ` <span class="tag">${h(SECTOR[x.sector])}</span>` : ""}</td><td>${h(x.type)}</td><td class="n">${x.support ? money(x.support) : "—"}</td><td class="n">${x.oppose ? money(x.oppose) : "—"}</td></tr>`).join("")}</table>
				<p class="note">Independent expenditures: money spent on ads and mailers about this candidate, not given to them. No contribution limits.</p>` : `<p class="note">No independent expenditures reported for or against this candidate this cycle.</p>`}
			${(f.leadership || []).map((l) => `<h3>Their leadership PAC <small>${h(l.name)}</small></h3>
				<div class="kv"><div><b>${money(l.total)}</b><span>From other PACs, 2025–26</span></div><div><b>${money(l.health_total)}</b><span>From health-industry PACs</span></div></div>
				${l.health.length ? `<table class="t"><tr><th>Health-industry PAC</th><th>Sector</th><th class="n">Given</th></tr>${l.health.map((x) => `<tr><td><a href="https://www.fec.gov/data/committee/${h(x.id)}/" target="_blank" rel="noopener">${h(x.name)}</a></td><td><span class="tag">${h(SECTOR[x.sector] || x.sector)}</span></td><td class="n">${money(x.amount)}</td></tr>`).join("")}</table>` : ""}
				${l.top.length ? `<details class="admin"><summary>Top PAC donors to ${h(l.name)}</summary><table class="t">${l.top.map((x) => `<tr><td><a href="https://www.fec.gov/data/committee/${h(x.id)}/" target="_blank" rel="noopener">${h(x.name)}</a></td><td class="n">${money(x.amount)}</td></tr>`).join("")}</table></details>` : ""}
				<p class="note">A leadership PAC is a second fund the member controls. PACs that already gave the campaign the legal maximum can give here too. <a href="https://www.fec.gov/data/committee/${h(l.id)}/" target="_blank" rel="noopener">FEC filing ↗</a></p>`).join("")}`;
	}
	dlg.innerHTML = `<div class="dhead">${avatar(p)}
			<div style="flex:1"><h2>${h(p.name)}</h2><div class="meta"><span class="party ${h(p.party)}">${h(PARTY[p.party] || p.party)}</span> · ${h(p.role)}${p.chamber === "executive" ? "" : " · " + h(seat(p))}${p.status === "incoming" ? " · new in 2027" : ""}</div>
				<div class="meta">${p.status === "departing" ? "Leaving Congress January 3, 2027" : `${p.term_end ? `Serving ${p.status === "incoming" || p.chamber === "house" ? "Jan 3, 2027" : "now"} – ${h(fmtDate(p.term_end))}` : ""}${p.next_election ? ` · <b>next election ${h(fmtDate(p.next_election))}</b>` : ""}`}</div></div>
			<div class="links dact">${callBtn(p, "btn primary call")}<button class="btn" data-close aria-label="Close">Close</button></div></div>
		<div class="dbody">
			${shareButtons(p.id)}
			<h3>Where they stand</h3>
			${S.data.policies.map((pl) => {
				const x = pos[pl.id], st = x?.stance || "unknown";
				return `<div class="stance-box" style="--stance:var(--s-${st})"><div class="lbl">${h(pl.name)}</div><div class="val">${h(STANCE[st])}</div>
					<p>${h(x?.note || (st === "unknown" ? "Not a cosponsor, and nothing documented yet." : ""))} ${x?.source_url ? `<a href="${url(x.source_url)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</p>
					${x?.updated_at ? `<p class="note">Updated ${h(fmtDate(x.updated_at))}</p>` : ""}
					${S.admin ? adminProfileTools.stance(p, pl, x) : ""}</div>`;
			}).join("")}
			${p.notes ? `<p class="note">${h(p.notes)}</p>` : ""}
			${leanBox(p)}
			${alignmentBox(f)}
			${votesBox(p)}
			<div id="vrec"><h3>Full voting record</h3><p class="note">Loading…</p></div>
			${issueMatrix(p, d.issue_positions || [])}
			<h3>On the record <small>${d.appearances.length} documented: shows, quotes, votes, posts</small></h3>
			<div class="feed">${d.appearances.map((a) => appHtml(a, false)).join("") || `<p class="note">No appearances documented yet.</p>`}</div>
			${S.admin ? adminProfileTools.appearance(p) : ""}
			<h3>Call or write them</h3>
			<div class="contact">
				<div><b>${p.phone_label ? "Phone" : "Washington office"}</b>${p.phone ? `<a href="${tel(p.phone)}">${h(p.phone)}</a>` : "—"}${p.phone_label ? `<span class="note">${h(p.phone_label)}</span>` : p.office ? `<span class="note">${h(p.office)}</span>` : ""}</div>
				${offices.map((o) => `<div><b>${h(o.city)}${o.state ? ", " + h(o.state) : ""}</b>${o.phone ? `<a href="${tel(o.phone)}">${h(o.phone)}</a>` : "—"}<span class="note">${h([o.address, o.zip].filter(Boolean).join(" "))}</span></div>`).join("")}
			</div>
			${p.contact_form ? `<p><a class="btn small" href="${url(p.contact_form)}" target="_blank" rel="noopener">Email them (contact form) ↗</a></p>` : ""}
			<p class="note">Tap a number to call from a phone; on a Mac it opens FaceTime or your iPhone.${offices.length ? " District offices are often easier to reach than Washington." : ""}</p>
			${cmtes.length ? `<h3>Committees <small>119th Congress · new assignments come in January</small></h3>
				<div class="cmtes">${cmtes.map((c) => `<span class="tag${c.health ? " healthc" : ""}">${h(c.name)}${c.title ? " · " + h(c.title) : ""}</span>`).join("")}</div>
				${cmtes.some((c) => c.health) ? `<p class="note"><b>Sits on a committee that writes health-care law</b> (highlighted). Bills like Medicare for All go through these first.</p>` : ""}` : ""}
			<h3>Find them online</h3>
			<div class="links">${link(p.website, "Official site")}${tw(p.twitter, "Official X")}${alts.map((a) => tw(a, "Other X")).join("")}
				${p.bluesky ? link("https://bsky.app/profile/" + encodeURIComponent(p.bluesky), "Bluesky") : ""}${p.facebook ? link("https://www.facebook.com/" + encodeURIComponent(p.facebook), "Facebook") : ""}${p.instagram ? link("https://www.instagram.com/" + encodeURIComponent(p.instagram), "Instagram") : ""}${link(p.youtube, "YouTube")}</div>

			${alts.length ? `<p class="note">"Other X" accounts come from Wikidata and may be campaign, personal or retired handles — verify before citing.</p>` : ""}
			<h3>Who pays them <small>FEC, ${h(f?.cycle || "2025–26")} cycle</small></h3>
			${moneyHtml}
			${d.donors.length ? `<h3>Documented by hand</h3><table class="t"><tr><th>Donor</th><th>Type</th><th class="n">Amount</th><th></th></tr>${d.donors.map((x) => `<tr><td>${x.source_url ? `<a href="${url(x.source_url)}" target="_blank" rel="noopener">${h(x.donor_name)}</a>` : h(x.donor_name)}${x.sector ? ` <span class="tag">${h(x.sector)}</span>` : ""}${x.notes ? `<br><span class="note">${h(x.notes)}</span>` : ""}</td><td>${h(x.donor_type || "")}${x.cycle ? ` · ${h(x.cycle)}` : ""}</td><td class="n">${x.amount != null ? money(x.amount) : "—"}</td><td>${S.admin ? `<button class="btn small danger" data-del="donors" data-delid="${x.id}">Delete</button>` : ""}</td></tr>`).join("")}</table>` : ""}
			${S.admin ? adminProfileTools.donor(p) : ""}
			<div id="pwebwrap"></div>
			<h3>Dig deeper</h3>
			<div class="links">${p.opensecrets_id ? link("https://www.opensecrets.org/members-of-congress/summary?cid=" + encodeURIComponent(p.opensecrets_id), "OpenSecrets: donors by industry") : ""}
				${fec.map((id) => link("https://www.fec.gov/data/candidate/" + encodeURIComponent(id) + "/", "FEC " + id)).join("")}
				${p.govtrack_id ? link("https://www.govtrack.us/congress/members/" + encodeURIComponent(p.govtrack_id), "GovTrack") : ""}
				${p.chamber !== "executive" && !p.id.startsWith("X-") ? link("https://www.congress.gov/member/x/" + encodeURIComponent(p.id), "Congress.gov") : ""}
				${p.wikipedia ? link("https://en.wikipedia.org/wiki/" + encodeURIComponent(p.wikipedia.replace(/ /g, "_")), "Wikipedia") : ""}</div>
			<p class="note">Health-industry PACs are flagged by matching PAC and parent-company names: pharma and distributors, insurers and PBMs, hospitals, medical devices, care providers (dialysis, labs, nursing homes, physician staffing) and doctors' groups. Nurses' groups and unions are left out. Donations from individual executives and employees aren't industry-coded by the FEC; OpenSecrets has that breakdown.</p>
			${S.admin ? adminProfileTools.edit(p) : ""}
		</div>`;
	dlg.dataset.id = p.id;
	votingRecord(dlg.querySelector("#vrec"), p);
	moneyWeb(dlg.querySelector("#pwebwrap"), p, f);
	if (!dlg.open) dlg.showModal();
	dlg.scrollTop = dlg.dataset.keep === p.id ? Number(dlg.dataset.scroll || 0) : 0;
	delete dlg.dataset.keep;
}
export async function refresh(keepProfile) {
	const dlg = $("#drawer");
	if (keepProfile && dlg.open) { dlg.dataset.keep = dlg.dataset.id; dlg.dataset.scroll = dlg.scrollTop; }
	await load();
	route();
}

// ------------------------------------------------------------------ routing + events
function route() {
	const hash = location.hash || "#/";
	const dlg = $("#drawer");
	const m = hash.match(/^#\/p\/(.+)$/);
	// A profile opens as a drawer over whatever page was showing; other hashes pick the page.
	const page = m ? route.back || "#/" : hash;
	if (!m) route.back = hash;
	if (!m || route.dirty || route.view !== page) {
		if (page.startsWith("#/admin")) renderAdmin();
		else if (page.startsWith("#/issues")) renderIssues();
		else if (page.startsWith("#/elections")) renderElections(page.split("/")[2] || "");
		else if (page.startsWith("#/votes")) renderVotes();
		else if (page.startsWith("#/money")) renderMoney(page.split("/").slice(2));
		else if (page.startsWith("#/zip")) renderZip(decodeURIComponent(page.split("/")[2] || ""));
		else renderMain();
		route.view = page;
	}
	route.dirty = false;
	if (m) openProfile(decodeURIComponent(m[1]));
	else if (dlg.open) dlg.close();
}
export const markDirty = () => (route.dirty = true);
export const rerender = () => { markDirty(); route(); };

function bind() {
	const tip = $("#tip");
	document.addEventListener("click", async (e) => {
		const t = e.target;
		const cg = t.closest("[data-congress]");
		if (cg) { S.congress = Number(cg.dataset.congress); S.mapState = ""; S.f.cohort = ""; applyCongress(); renderMain(); return; }
		if (t.closest("[data-logout]")) { e.preventDefault(); await api("logout", { method: "POST" }); toast("Signed out"); markDirty(); await refresh(); return; }
		if (t.closest("[data-close]")) { location.hash = route.back || "#/"; return; }
		const del = t.closest("[data-del]");
		if (del) return; // handled in admin.js
		const el = t.closest("[data-id]");
		if (el && !t.closest("form")) location.hash = "#/p/" + encodeURIComponent(el.dataset.id);
	});
	$("#drawer").addEventListener("close", () => { if (location.hash.startsWith("#/p/")) location.hash = route.back || "#/"; });
	$("#drawer").addEventListener("click", (e) => { if (e.target === e.currentTarget) location.hash = route.back || "#/"; });
	document.addEventListener("input", (e) => {
		const t = e.target;
		if (t.id === "q" && $("#list")) { S.f.q = t.value; $("#list").innerHTML = listHtml(); }
	});
	document.addEventListener("change", (e) => {
		const t = e.target;
		if (t.dataset.f && $("#list")) { S.f[t.dataset.f] = t.value; $("#list").innerHTML = listHtml(); }
		if (t.id === "health") { S.f.health = t.checked; $("#list").innerHTML = listHtml(); }
		if (t.id === "hcmte") { S.f.hcmte = t.checked; $("#list").innerHTML = listHtml(); }
		if (t.id === "policy") { S.policy = t.value; indexPositions(); renderMain(); }
		if (t.id === "congress") { S.congress = Number(t.value); S.mapState = ""; S.f.cohort = ""; applyCongress(); renderMain(); }
	});
	document.addEventListener("mouseover", (e) => {
		const c = e.target.closest?.(".hemi circle, .seatdot[data-id]");
		if (!c) { tip.hidden = true; return; }
		const p = S.data.politicians.find((x) => x.id === c.dataset.id);
		if (!p) { tip.hidden = true; return; }
		tip.innerHTML = `<b>${h(p.name)}</b> (${h(p.party)}-${h(seat(p))})<small>${h(STANCE[stanceOf(p.id)])}${p.lean && p.lean !== "unknown" ? ` · ${h(LEAN[p.lean])}` : ""}${p.health_total > 0 ? ` · ${short(p.health_total)} from health-industry PACs` : ""}</small>`;
		tip.hidden = false;
		const r = c.getBoundingClientRect();
		tip.style.left = Math.min(Math.max(r.left + r.width / 2 - tip.offsetWidth / 2, 8), innerWidth - tip.offsetWidth - 8) + "px";
		tip.style.top = (r.top - tip.offsetHeight - 8 < 0 ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + "px";
	});
	window.addEventListener("hashchange", route);
	bindAdmin();
	bindViews();
	bindZip();
	bindShare();
	bindMoney();
}

load().then(() => { bind(); route(); }).catch((e) => { $("#app").innerHTML = `<p class="loading">Couldn't load data: ${h(e.message)}</p>`; });
