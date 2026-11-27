import { S, h, url, api, toast, chrome, footer, seat, stanceOf, pill, avatar, STANCE, STANCE_ORDER, PARTY, year, fmtDate, isNext, congressLabel } from "./main.js";
import { loadD3 } from "./money.js";

const $ = (s, el = document) => el.querySelector(s);

export const LEAN = {
	left3: "Far left", left2: "Left", left1: "Slightly left", center: "Center",
	right1: "Slightly right", right2: "Right", right3: "Far right", unknown: "Unknown",
};
export const ISSUE_POS = {
	left3: "Strongly progressive", left2: "Progressive", left1: "Leans progressive", center: "Mixed / moderate",
	right1: "Leans conservative", right2: "Conservative", right3: "Strongly conservative", unknown: "Not documented",
};
const SCALE7 = ["left3", "left2", "left1", "center", "right1", "right2", "right3"];
const STATE_NAMES = {
	AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
	DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
	KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
	MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
	NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
	OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
	TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
	WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands",
	AS: "American Samoa", MP: "Northern Mariana Islands",
};
// Equal-size tile map: [column, row]. Every state gets the same space, so small states stay readable.
const TILES = {
	AK: [0, 0], ME: [10, 0], WI: [5, 1], VT: [9, 1], NH: [10, 1],
	WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], MI: [6, 2], NY: [8, 2], MA: [9, 2],
	OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3], RI: [10, 3],
	CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
	AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
	OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
	HI: [0, 7], TX: [3, 7], FL: [8, 7], PR: [10, 7],
};
const MODES = { party: "Party", m4a: "Medicare for All", lean: "Lean" };
const PORDER = { D: 0, I: 1, R: 2 };

const color = (p) => (S.mapMode === "party" ? `var(--p-${p.party || "I"})` : S.mapMode === "lean" ? `var(--l-${p.lean || "unknown"})` : `var(--s-${stanceOf(p.id)})`);
const sortSeat = (a, b) => (PORDER[a.party] ?? 1) - (PORDER[b.party] ?? 1) || (a.district || 0) - (b.district || 0);
const members = () => S.data.politicians.filter((p) => p.chamber !== "executive");
const byState = () => {
	const m = {};
	for (const p of members()) (m[p.state] ||= { senate: [], house: [] })[p.chamber === "senate" ? "senate" : "house"].push(p);
	return m;
};

function partyBar(list, total, label) {
	const c = { D: 0, I: 0, R: 0 };
	list.forEach((p) => (c[p.party in c ? p.party : "I"] += 1));
	const empty = Math.max(total - list.length, 0);
	const maj = Math.floor(total / 2) + 1;
	return `<div class="meter"><h3><b>${h(label)}</b><span>${c.D} D · ${c.R} R${c.I ? ` · ${c.I} I` : ""}${empty ? ` · ${empty} undecided` : ""}</span></h3>
		<div class="bar">${["D", "I", "R"].filter((k) => c[k]).map((k) => `<i style="flex:${c[k]};background:var(--p-${k})" title="${PARTY[k]}: ${c[k]}"></i>`).join("")}${empty ? `<i style="flex:${empty};background:var(--s-unknown)" title="Undecided: ${empty}"></i>` : ""}
		<span class="tick" style="left:${(maj / total) * 100}%" data-label="${maj} for a majority"></span></div></div>`;
}

function legendHtml() {
	if (S.mapMode === "party") return Object.entries(PARTY).map(([k, v]) => `<span><i class="dot" style="background:var(--p-${k})"></i>${v}</span>`).join("");
	if (S.mapMode === "lean") return [...SCALE7, "unknown"].map((k) => `<span><i class="dot" style="background:var(--l-${k})"></i>${LEAN[k]}</span>`).join("");
	return STANCE_ORDER.map((s) => `<span><i class="dot c-${s}"></i>${h(STANCE[s])}</span>`).join("");
}

export function mapHtml() {
	const st = byState(), all = members();
	const sen = all.filter((p) => p.chamber === "senate"), house = all.filter((p) => p.chamber === "house" && p.voting);
	const tiles = Object.entries(TILES).map(([abbr, [c, r]]) => {
		const s = st[abbr] || { senate: [], house: [] };
		const hs = [...s.house].sort(sortSeat), ss = [...s.senate].sort(sortSeat);
		const cnt = { D: 0, R: 0, I: 0 };
		[...hs, ...ss].forEach((p) => (cnt[p.party in cnt ? p.party : "I"] += 1));
		const maj = cnt.D > cnt.R ? "var(--p-D)" : cnt.R > cnt.D ? "var(--p-R)" : "var(--s-unknown)"; // tie = neutral
		const dot = (p, cls) => `<i class="seatdot ${cls}" data-id="${h(p.id)}" style="background:${color(p)}"></i>`;
		const sel = S.mapState === abbr ? " sel" : "";
		return `<div class="tile${sel}" role="button" tabindex="0" data-state="${abbr}" style="grid-column:${c + 1};grid-row:${r + 1};--maj:${maj}"
			aria-label="${h(STATE_NAMES[abbr])}: ${ss.length} senators, ${hs.length} House seats. ${cnt.D} Democrats, ${cnt.R} Republicans${cnt.I ? `, ${cnt.I} independents` : ""}.">
			<b>${abbr}</b>
			<span class="sen">${ss.map((p) => dot(p, "s")).join("")}</span>
			<span class="hs">${hs.map((p) => dot(p, "h")).join("")}</span>
			<span class="cnt">${hs.length} House</span>
		</div>`;
	}).join("");
	const extra = members().filter((p) => !TILES[p.state]);
	return `<div class="maphead">
			<div><h2>Who holds the seats</h2><p class="sub">${h(congressLabel())} · each state shows its 2 senators (big dots) and House seats (small dots). Tap a state for its members, or a dot for a profile.</p></div>
			<span class="links"><label class="check">View <select id="mapview"><option value="states"${S.mapView !== "districts" ? " selected" : ""}>States</option><option value="districts"${S.mapView === "districts" ? " selected" : ""}>House districts</option></select></label>
			<label class="check">Color by <select id="mapmode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${S.mapMode === k ? " selected" : ""}>${v}</option>`).join("")}</select></label></span>
		</div>
		<div class="mapmeters">${partyBar(sen, 100, "Senate")}${partyBar(house, 435, "House")}</div>
		${S.mapView === "districts" ? `<div id="distmap" class="distmap"><p class="note">Drawing the 2027 district lines…</p></div>
			<p class="note">Every House district as drawn for the Congress sworn in January 3, 2027 (Census TIGER 2026 boundaries). Hover for the member, click to open their profile.${isNext() ? "" : " District lines and members shown are the 2027 ones."} Territories' delegates are listed below.</p>` : `<div class="tilemap">${tiles}</div>`}
		<div class="legend">${legendHtml()}</div>
		${extra.length ? `<p class="note">Non-voting delegates: ${extra.map((p) => `<a href="#/p/${h(p.id)}">${h(p.name)} (${h(p.state)})</a>`).join(", ")}</p>` : ""}`;
}

const miniRow = (p) => `<button class="row" style="--stance:var(--s-${stanceOf(p.id)})" data-id="${h(p.id)}">${avatar(p)}
	<span><span class="name">${h(p.name)}</span><br><span class="meta"><span class="party ${h(p.party)}">${h(p.party)}</span> · ${h(seat(p))}${p.status === "incoming" ? ` · <span class="tag new">New</span>` : ""}${p.lean && p.lean !== "unknown" ? ` · ${h(LEAN[p.lean])}` : ""}</span></span>
	<span class="right">${pill(stanceOf(p.id))}<span>${p.status === "departing" ? "Leaving Jan 3, 2027" : p.next_election ? `Next election ${year(p.next_election)}` : ""}</span></span></button>`;

export function stateHtml() {
	if (!S.mapState) return "";
	const s = byState()[S.mapState] || { senate: [], house: [] };
	const undecided = isNext() ? (S.data.meta?.undecided || []).filter((x) => x.startsWith(S.mapState + "-")) : [];
	return `<section class="card statecard">
		<div class="maphead"><div><h2>${h(STATE_NAMES[S.mapState] || S.mapState)}</h2><p class="sub">${s.senate.length} senators · ${s.house.length} House seat${s.house.length === 1 ? "" : "s"}${undecided.length ? ` · ${h(undecided.join(", "))} undecided` : ""}</p></div>
			<span class="links"><a class="btn small" href="#/state/${h(S.mapState)}">State government</a><a class="btn small" href="#/elections/${h(S.mapState)}">2026 results</a><button class="btn small" data-clearstate>Close</button></span></div>
		<h3 class="mini">Senate</h3><div class="list compact">${[...s.senate].sort(sortSeat).map(miniRow).join("") || `<p class="note">None.</p>`}</div>
		<h3 class="mini">House</h3><div class="list compact">${[...s.house].sort((a, b) => (a.district || 0) - (b.district || 0)).map(miniRow).join("") || `<p class="note">None.</p>`}</div>
	</section>`;
}

// ------------------------------------------------------------------ profile pieces
function scaleBar(pos) {
	return `<span class="scale" aria-hidden="true">${SCALE7.map((k) => `<i class="${k === pos ? "on" : ""}" style="--c:var(--l-${k})"></i>`).join("")}</span>`;
}

export function leanBox(p) {
	const lean = p.lean || "unknown";
	return `<div class="stance-box" style="--stance:var(--l-${lean})"><div class="lbl">Overall lean</div>
		<div class="val">${h(LEAN[lean])}</div>${lean !== "unknown" ? scaleBar(lean) : ""}
		<p>${h(p.lean_note || (lean === "unknown" ? "No voting record yet, and not rated by hand." : ""))}${p.lean_source === "admin" ? " (Set by hand.)" : ""}</p>
		${S.admin ? `<details class="admin"><summary>Edit lean</summary><form class="form" data-form="lean" data-id="${h(p.id)}">
			<div class="grid"><label>Lean<select name="lean">${Object.entries(LEAN).map(([k, v]) => `<option value="${k}"${k === lean ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
			<label>Why<textarea name="lean_note" placeholder="What they've said or done that puts them here">${h(p.lean_source === "admin" ? p.lean_note || "" : "")}</textarea></label>
			<div class="actions"><button class="btn primary">Save lean</button></div></form></details>` : ""}</div>`;
}

export function issueMatrix(p, ipos) {
	const issues = S.data.issues || [];
	if (!issues.length) return "";
	const pos = Object.fromEntries(ipos.map((x) => [x.issue_id, x]));
	const documented = issues.filter((i) => pos[i.id] && pos[i.id].position !== "unknown").length;
	const rows = issues.map((i) => {
		const x = pos[i.id], v = x?.position || "unknown";
		return `<tr><td><a href="#/issues" class="iname">${h(i.name)}</a></td>
			<td>${v === "unknown" ? `<span class="note">Not documented</span>` : `${scaleBar(v)}<span class="plabel">${h(ISSUE_POS[v])}</span>`}
				${x?.note || x?.source_url ? `<div class="note">${h(x.note || "")} ${x.source_url ? `<a href="${url(x.source_url)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div>` : ""}
				${S.admin ? `<details class="admin"><summary>Edit</summary><form class="form" data-form="issuepos">
					<input type="hidden" name="politician_id" value="${h(p.id)}"><input type="hidden" name="issue_id" value="${h(i.id)}">
					<div class="grid"><label>Position<select name="position">${Object.entries(ISSUE_POS).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
					<label>Source link<input type="url" name="source_url" value="${h(x?.source_url || "")}" placeholder="https://"></label></div>
					<label>What they said<textarea name="note">${h(x?.note || "")}</textarea></label>
					<div class="actions"><button class="btn primary small">Save</button></div></form></details>` : ""}</td></tr>`;
	}).join("");
	return `<h3>Positions on the top issues <small>${documented} of ${issues.length} documented</small></h3>
		<table class="t matrix"><tr><th>Issue</th><th>Position <span class="scalekey">progressive ← → conservative</span></th></tr>${rows}</table>
		<p class="note">Snapshot from their public statements, website and record, entered by hand with a source.</p>`;
}

// ------------------------------------------------------------------ issues page
export function renderIssues() {
	const issues = S.data.issues || [], polls = S.data.issue_polls || [];
	const byIssue = {};
	polls.forEach((p) => (byIssue[p.issue_id] ||= []).push(p));
	const adminPoll = (iid, p = {}) => `<form class="form" data-form="poll"${p.id ? ` data-id="${p.id}"` : ""}><input type="hidden" name="issue_id" value="${h(iid)}">
		<div class="grid"><label>Pollster<input type="text" name="pollster" value="${h(p.pollster || "")}" list="pollsters" required></label>
		<label>Date<input type="text" name="date" value="${h(p.date || "")}" placeholder="2026-10"></label>
		<label>Link<input type="url" name="url" value="${h(p.url || "")}" placeholder="https://"></label></div>
		<label>Finding<input type="text" name="stat" value="${h(p.stat || "")}" placeholder="41% call it a very big problem" required></label>
		<div class="actions"><button class="btn primary small">${p.id ? "Save" : "Add poll"}</button>${p.id ? `<button type="button" class="btn small danger" data-del="issue_polls" data-delid="${p.id}">Delete</button>` : ""}</div></form>`;
	const issueForm = (i = {}) => `<form class="form" data-form="issue"${i.id ? ` data-id="${h(i.id)}"` : ""}>
		<div class="grid"><label>Issue<input type="text" name="name" value="${h(i.name || "")}" required></label>
		<label>Rank<input type="number" name="rank" min="1" value="${h(i.rank ?? "")}"></label></div>
		<label>Description<textarea name="description">${h(i.description || "")}</textarea></label>
		<div class="actions"><button class="btn primary small">${i.id ? "Save issue" : "Add issue"}</button>${i.id ? `<button type="button" class="btn small danger" data-del="issues" data-delid="${h(i.id)}">Delete issue</button>` : ""}</div></form>`;
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>What Americans say matters most</h2><span>${issues.length} issues · ranked by recent polling</span></div>
		<p class="lede">The issues voters rank highest, with the latest public polling for each. Every member's profile shows where they stand on these, based on what they've said and their record.</p>
		${S.admin ? `<details class="admin"><summary>+ Add an issue</summary>${issueForm()}</details>` : ""}
		<div class="issues">${issues.map((i) => `<article class="card issue" id="issue-${h(i.id)}">
			<div class="ihead"><span class="rank">${h(i.rank ?? "")}</span><div><h3>${h(i.name)}</h3><p>${h(i.description || "")}</p></div></div>
			${(byIssue[i.id] || []).length ? `<ul class="polls">${byIssue[i.id].map((p) => `<li><span>${h(p.stat)}</span>
				<span class="src">${p.url ? `<a href="${url(p.url)}" target="_blank" rel="noopener">${h(p.pollster)}</a>` : h(p.pollster)}${p.date ? ` · ${h(p.date)}` : ""}</span>
				${S.admin ? `<details class="admin"><summary>Edit</summary>${adminPoll(i.id, p)}</details>` : ""}</li>`).join("")}</ul>` : `<p class="note">No polling linked yet.</p>`}
			${S.admin ? `<details class="admin"><summary>+ Add a poll</summary>${adminPoll(i.id)}</details><details class="admin"><summary>Edit issue</summary>${issueForm(i)}</details>` : ""}
		</article>`).join("") || `<p class="empty">No issues yet.${S.admin ? " Add one above." : ""}</p>`}</div>
		<datalist id="pollsters"><option value="Pew Research Center"><option value="Gallup"><option value="AP-NORC"><option value="Fox News"><option value="KFF"><option value="Quinnipiac"><option value="Marist"><option value="NYT/Siena"><option value="YouGov/Economist"></datalist>
	</main>${footer()}`;
}

// ------------------------------------------------------------------ elections page
const pct = (x) => (x == null ? "—" : x.toFixed(1) + "%");
function raceRow(r) {
	const c = [...r.candidates].sort((a, b) => (b.won - a.won) || ((b.pct ?? -1) - (a.pct ?? -1)));
	const w = c.find((x) => x.won) || null, ru = c.find((x) => x !== w);
	const margin = w?.pct != null && ru?.pct != null ? (w.pct - ru.pct).toFixed(1) : null;
	const wp = r.winner_id && S.byId.get(r.winner_id);
	const name = w ? (wp ? `<a href="#/p/${h(wp.id)}">${h(w.name)}</a>` : h(w.name)) : "<i>Undecided</i>";
	const label = r.chamber === "senate" ? `${h(STATE_NAMES[r.state] || r.state)}${r.special ? " (special)" : ""}` : `${h(r.state)}-${r.district ? h(r.district) : "AL"}`;
	return `<tr>
		<td><b>${label}</b>${r.pvi ? `<br><span class="tag">${h(r.pvi)}</span>` : ""}</td>
		<td>${w ? `<span class="party ${h(w.party)}">${h(w.party)}</span> ` : ""}${name} <span class="n">${pct(w?.pct)}</span>
			${ru ? `<br><span class="note">${h(ru.name)} (${h(ru.party)}) ${pct(ru.pct)}</span>` : ""}</td>
		<td class="n">${margin != null ? `+${margin}` : "—"}</td>
		<td class="note">${h(r.result)}</td></tr>
		${r.exit_polls?.length ? `<tr class="exitrow"><td></td><td colspan="3"><ul class="polls">${r.exit_polls.map((x) => `<li><span>${h(x.stat)}</span> <span class="src"><a href="${url(x.url)}" target="_blank" rel="noopener">${h(x.source || "Source")}</a></span></li>`).join("")}</ul></td></tr>` : ""}`;
}

export async function renderElections(state) {
	if (!S.races) {
		$("#app").innerHTML = `${chrome()}<p class="loading">Loading results…</p>`;
		try { S.races = await api("races"); } catch (e) { toast(e.message, true); return; }
	}
	const st = (state || "").toUpperCase();
	const senate = S.races.filter((r) => r.chamber === "senate" && (!st || r.state === st));
	const house = S.races.filter((r) => r.chamber === "house" && (!st || r.state === st));
	const nat = S.data.meta?.exit_national || [];
	const states = [...new Set(S.races.map((r) => r.state))].sort();
	const byState = {};
	house.forEach((r) => (byState[r.state] ||= []).push(r));
	const head = `<tr><th>Race</th><th>Winner / runner-up</th><th class="n">Margin</th><th>Outcome</th></tr>`;
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>2026 election results</h2><span>November 3, 2026 · snapshot</span></div>
		<div class="filters" style="position:static"><label class="check">State <select id="elecstate"><option value="">All states</option>${states.map((s) => `<option value="${s}"${s === st ? " selected" : ""}>${h(STATE_NAMES[s] || s)}</option>`).join("")}</select></label></div>
		${!st && nat.length ? `<section class="card"><h2>What voters said nationally</h2><p class="sub">Exit polls and voter surveys</p>
			<ul class="polls">${nat.map((x) => `<li><span>${h(x.stat)}</span> <span class="src"><a href="${url(x.url)}" target="_blank" rel="noopener">${h(x.source || "Source")}</a></span></li>`).join("")}</ul></section>` : ""}
		<div class="section-title"><h2>Senate</h2><span>${senate.length} race${senate.length === 1 ? "" : "s"} · exit-poll findings under each race where available</span></div>
		${senate.length ? `<table class="t races">${head}${senate.map(raceRow).join("")}</table>` : `<p class="note">No Senate race in ${h(STATE_NAMES[st] || st)} this year.</p>`}
		<div class="section-title"><h2>House</h2><span>${house.length} races · Cook PVI shown under each district</span></div>
		${Object.entries(byState).map(([s, rs]) => `<details class="admin"${st ? " open" : ""}><summary>${h(STATE_NAMES[s] || s)} · ${rs.length} seat${rs.length === 1 ? "" : "s"}</summary>
			<table class="t races">${head}${rs.map(raceRow).join("")}</table></details>`).join("")}
		<p class="note">Results from <a href="${url(S.data.meta?.results_source)}" target="_blank" rel="noopener">Wikipedia's 2026 election pages</a> (AP-sourced). Where a percentage shows "—", the vote share wasn't posted yet when this snapshot was taken. Exit-poll findings are summarized from the linked poll pages; check the source before quoting a number.</p>
	</main>${footer()}`;
}

export function bindViews() {
	const pick = (st) => {
		S.mapState = S.mapState === st ? "" : st;
		const panel = $("#statepanel");
		if (panel) panel.innerHTML = stateHtml();
		document.querySelectorAll(".tile").forEach((t) => t.classList.toggle("sel", t.dataset.state === S.mapState));
		if (S.mapState && panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
	};
	document.addEventListener("click", (e) => {
		if (e.target.closest("[data-id]")) return; // a seat dot opens the profile instead
		const t = e.target.closest("[data-state]");
		if (t) pick(t.dataset.state);
		if (e.target.closest("[data-clearstate]")) pick(S.mapState);
	});
	document.addEventListener("keydown", (e) => {
		const t = e.target.closest?.("[data-state]");
		if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(t.dataset.state); }
	});
	document.addEventListener("change", (e) => {
		if (e.target.id === "mapmode" || e.target.id === "mapview") {
			if (e.target.id === "mapmode") S.mapMode = e.target.value; else S.mapView = e.target.value;
			$("#map").innerHTML = mapHtml();
			if (S.mapView === "districts") drawDistricts();
		}
		if (e.target.id === "elecstate") location.hash = "#/elections" + (e.target.value ? "/" + e.target.value : "");
	});
}

// ------------------------------------------------------------------ find your members by ZIP
const zipCache = {};
async function zipData(zip) {
	const k = zip[0];
	if (!zipCache[k]) {
		const r = await fetch(`/zip/${k}.json`);
		zipCache[k] = r.ok ? await r.json() : {};
	}
	return zipCache[k][zip] || null;
}
// Always the Congress sworn in Jan 3, 2027: the ZIP table is built from its district lines.
function next120() {
	const d = S.data, cg = d.meta?.default_congress || 120;
	const has = new Set((d.terms || []).filter((t) => t.congress === cg).map((t) => t.politician_id));
	const any = new Set((d.terms || []).map((t) => t.politician_id));
	return d.all.filter((p) => p.status !== "departing" && (has.has(p.id) || !any.has(p.id)));
}

export function zipBox(compact) {
	return `<form class="zipform${compact ? " compact" : ""}" data-zipform>
		<label for="zipq"><b>Who represents you?</b> <span>Enter your ZIP code to see your senators and House member, where they stand, and how to call them.</span></label>
		<div class="ziprow"><input id="zipq" name="zip" type="text" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" placeholder="ZIP code" value="${h(S.zip || "")}" required>
		<button class="btn primary">Find my members</button></div>
	</form>`;
}

const ASK_FED = "support the Medicare for All Act (H.R.3069 / S.1506) and cosponsor it when it is reintroduced in the new Congress";
// State officials carry their stance on the record itself (from /api/state); federal ones come from S.pos.
const stanceFor = (p) => p.stance || stanceOf(p.id);
function script(p, zip) {
	const st = stanceFor(p);
	const stateLevel = p.chamber === "governor" || p.chamber === "state_upper" || p.chamber === "state_lower";
	const title = p.chamber === "governor" ? (p.state === "DC" ? "Mayor" : "Governor") : p.chamber === "senate" || p.chamber === "state_upper" ? "Senator" : "Representative";
	const who = `${title} ${p.last || p.name}`;
	const place = STATE_NAMES[p.state] || p.state;
	const ASK = stateLevel
		? (p.chamber === "governor" ? `back single-payer health care for ${place} and sign a single-payer bill if the legislature passes one` : `sponsor and vote for single-payer health care legislation in ${place}`)
		: ASK_FED;
	const open = `Hi, my name is [your name] and I'm a constituent from ZIP code ${zip}. I'm calling about ${stateLevel ? "single-payer health care" : "Medicare for All"}.`;
	const body = {
		supports: stateLevel ? `I want to thank ${who} for supporting single-payer health care. Please keep fighting for it.` : `I want to thank ${who} for supporting Medicare for All. Please keep fighting for it, and cosponsor the bill again as soon as it's reintroduced.`,
		public_option: `I know ${who} has backed a public option. A public option isn't enough. I'm asking ${who} to ${ASK}.`,
		unclear: `I haven't been able to find a clear answer on where ${who} stands. I'm asking ${who} to ${ASK}. Can you tell me their position?`,
		opposes: `I'm disappointed that ${who} has opposed Medicare for All. Everyone deserves health care without bills or networks. I'm asking ${who} to ${ASK}.`,
		unknown: `I couldn't find ${who}'s position on Medicare for All. I'm asking ${who} to ${ASK}. Can you tell me where they stand?`,
	}[st] || "";
	return `${open} ${body} Thank you.`;
}

function memberCard(p, zip, share) {
	const st = stanceFor(p);
	const sc = script(p, zip);
	return `<article class="card zipcard" style="--stance:var(--s-${st})">
		<div class="zhead">${avatar(p)}<div><a class="name" href="#/p/${h(p.id)}">${h(p.name)}</a>
			<div class="meta"><span class="party ${h(p.party)}">${h(PARTY[p.party] || p.party)}</span> · ${p.chamber === "senate" ? `Senator, ${h(STATE_NAMES[p.state] || p.state)}` : p.chamber === "governor" ? `${h(p.role)}, ${h(STATE_NAMES[p.state] || p.state)}` : `${h(seat(p))}${share && share < 100 ? ` · covers ${share}% of this ZIP` : ""}`}${p.status === "incoming" ? ` · <span class="tag new">New</span>` : ""}</div></div></div>
		<div class="zstance">${pill(st)}</div>
		<div class="links">${p.phone ? `<a class="btn primary call" href="tel:+1${h(String(p.phone).replace(/\D/g, ""))}">📞 Call ${h(p.phone)}</a>` : ""}<a class="btn small" href="#/p/${h(p.id)}">Full profile</a><button type="button" class="btn small" data-card="${h(p.id)}">🖼 Share card</button></div>
		${p.phone_label ? `<p class="note">${h(p.phone_label)}</p>` : ""}
		<details class="script"><summary>What to say</summary><p class="sc">${h(sc)}</p><button type="button" class="btn small" data-copy="${h(sc)}">Copy script</button></details>
	</article>`;
}

export async function renderZip(zip) {
	S.zip = zip || "";
	let body = "";
	if (zip) {
		if (!/^\d{5}$/.test(zip)) body = `<p class="empty">Enter a 5-digit ZIP code.</p>`;
		else {
			const hit = await zipData(zip);
			if (!hit) {
				body = `<p class="empty">We couldn't place ZIP ${h(zip)}. PO-box-only and some business ZIPs aren't mapped to an area. Try the ZIP where you live, or <a href="#/">browse the map</a> to pick your state.</p>`;
			} else {
				const pool = next120();
				const state = hit[0][0];
				const sens = pool.filter((p) => p.chamber === "senate" && p.state === state);
				const reps = hit.map(([st, d, share]) => ({ p: pool.find((p) => p.chamber === "house" && p.state === st && (p.district || 0) === d), st, d, share }));
				const split = hit.length > 1;
				body = `<div class="section-title"><h2>Your members of Congress</h2><span>ZIP ${h(zip)} · ${h(STATE_NAMES[state] || state)} · the Congress sworn in Jan 3, 2027</span></div>
					${split ? `<p class="lede">Your ZIP code crosses ${hit.length} House districts, so we show each one. To be sure which is yours, check your street address with your state's election office or the <a href="https://www.house.gov/representatives/find-your-representative" target="_blank" rel="noopener">House's lookup ↗</a>; note that it shows the current districts until January 3.</p>` : ""}
					${sens.length ? `<h3 class="mini">Senators</h3><div class="zipgrid">${sens.map((p) => memberCard(p, zip)).join("")}</div>` : `<p class="note">${h(STATE_NAMES[state] || state)} has no senators.</p>`}
					<h3 class="mini">House</h3><div class="zipgrid">${reps.map((r) => r.p ? memberCard(r.p, zip, r.share) : `<article class="card zipcard"><b>${h(r.st)}-${r.d || "AL"}</b><p class="note">This seat is still undecided${split ? ` (covers ${r.share}% of this ZIP)` : ""}.</p></article>`).join("")}</div>
					<p class="note">Districts are matched by the share of the ZIP code's area inside each one (Census ZIP areas and 2027 district lines). New members' direct lines are assigned after January 3; until then their call button goes to the Capitol switchboard.</p>
					<div id="zipstate" data-st="${h(state)}"><p class="note">Loading your state officials…</p></div>`;
			}
		}
	}
	$("#app").innerHTML = `${chrome()}<main class="wrap"><section class="card zippage">${zipBox()}</section><div id="zipresult">${body}</div></main>${footer()}`;
	const box = $("#zipstate");
	if (box) stateReps(box, zip, box.dataset.st);
	if (!zip) $("#zipq")?.focus();
}

export function bindZip() {
	document.addEventListener("submit", (e) => {
		const f = e.target.closest("[data-zipform]");
		if (!f) return;
		e.preventDefault();
		const z = (f.zip.value || "").replace(/\D/g, "").slice(0, 5);
		location.hash = "#/zip/" + z;
	});
	document.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-copy]");
		if (!b) return;
		try { await navigator.clipboard.writeText(b.dataset.copy); toast("Script copied"); }
		catch { toast("Couldn't copy. Select the text and copy it instead.", true); }
	});
}

// ------------------------------------------------------------------ key health votes
const VOTE_LABEL = { yea: "Yes", nay: "No", present: "Present", not_voting: "Didn't vote" };
let voteIndex = null;
function votesByMember() {
	if (!voteIndex || voteIndex.src !== S.data.member_votes) {
		const m = new Map();
		for (const [vid, pid, v] of S.data.member_votes || []) {
			if (!m.has(pid)) m.set(pid, {});
			m.get(pid)[vid] = v;
		}
		voteIndex = { src: S.data.member_votes, m };
	}
	return voteIndex.m;
}
const visibleVotes = () => (S.data.key_votes || []).filter((v) => S.admin || !v.hidden);
// "protected" = voted the way that protects or expands coverage on that vote.
const sideOf = (v, vote) => (vote === "yea" || vote === "nay" ? (vote === v.coverage_side ? "pro" : "anti") : "none");

export function voteScore(id) {
	const mine = votesByMember().get(id);
	if (!mine) return null;
	let pro = 0, cast = 0;
	for (const v of visibleVotes().filter((x) => !x.hidden)) {
		const s = sideOf(v, mine[v.id]);
		if (s !== "none") { cast++; if (s === "pro") pro++; }
	}
	return cast ? { pro, cast } : null;
}

export function votesBox(p) {
	const votes = visibleVotes().filter((v) => !v.hidden);
	if (!votes.length) return "";
	const mine = votesByMember().get(p.id) || {};
	const rows = votes.map((v) => {
		const vote = mine[v.id];
		const s = sideOf(v, vote);
		const cell = vote ? `<span class="vchip ${s}">${h(VOTE_LABEL[vote] || vote)}</span>` : `<span class="note">${p.chamber === v.chamber ? "Not in office yet" : "Other chamber"}</span>`;
		return `<tr><td><span class="note">${h(fmtDate(v.date))} · ${v.chamber === "senate" ? "Senate" : "House"}</span><br><a href="#/votes" class="iname">${h(v.title)}</a></td><td>${cell}</td></tr>`;
	}).join("");
	const sc = voteScore(p.id);
	return `<h3>Key health votes <small>${sc ? `protected coverage on ${sc.pro} of ${sc.cast}` : "no votes cast on these"}</small></h3>
		<table class="t kvotes"><tr><th>Vote</th><th>How they voted</th></tr>${rows}</table>
		<p class="note"><span class="vchip pro">Green</span> = voted the way that protects or expands health coverage; <span class="vchip anti">red</span> = the other way. <a href="#/votes">What each vote was about</a>.</p>`;
}

export function renderVotes() {
	const votes = visibleVotes();
	const vm = votesByMember();
	const pol = (id) => S.byId.get(id);
	const body = votes.map((v) => {
		const t = v.tally || {};
		const party = { D: { yea: 0, nay: 0 }, R: { yea: 0, nay: 0 }, I: { yea: 0, nay: 0 } };
		const pro = [], anti = [];
		for (const [pid, mv] of vm) {
			const vote = mv[v.id];
			if (!vote) continue;
			const p = pol(pid);
			if (p && party[p.party] && (vote === "yea" || vote === "nay")) party[p.party][vote]++;
			const s = sideOf(v, vote);
			if (p && s === "pro") pro.push(p); else if (p && s === "anti") anti.push(p);
		}
		const names = (list) => list.sort((a, b) => a.last.localeCompare(b.last)).map((p) => `<a href="#/p/${h(p.id)}" class="vname">${h(p.name)} <span class="party ${h(p.party)}">${h(p.party)}</span>${p.status === "departing" ? " <span class='tag'>Leaving</span>" : ""}</a>`).join("");
		const side = v.coverage_side === "yea" ? "Yes" : "No";
		return `<article class="card kvote${v.hidden ? " hiddenv" : ""}" id="vote-${h(v.id)}">
			<div class="note">${h(fmtDate(v.date))} · ${v.chamber === "senate" ? "Senate" : "House"} · ${h(v.question || "")}</div>
			<h3>${h(v.title)}</h3>
			<p>${h(v.yes_means || "")}</p>
			<div class="kv"><div><b>${t.yea || 0}–${t.nay || 0}</b><span>Yes–No</span></div>
				${Object.entries(party).filter(([, c]) => c.yea + c.nay).map(([k, c]) => `<div><b>${c.yea}–${c.nay}</b><span>${h(PARTY[k])}s</span></div>`).join("")}</div>
			<p class="note">Protecting coverage on this vote meant voting <b>${side}</b>. <a href="${url(v.source_url)}" target="_blank" rel="noopener">Official roll call ↗</a></p>
			<details class="admin"><summary>Voted to protect coverage (${pro.length})</summary><div class="vnames">${names(pro)}</div></details>
			<details class="admin"><summary>Voted the other way (${anti.length})</summary><div class="vnames">${names(anti)}</div></details>
			${S.admin ? `<details class="admin"><summary>Edit this vote</summary><form class="form" data-form="keyvote" data-id="${h(v.id)}">
				<label>Title<input type="text" name="title" value="${h(v.title || "")}"></label>
				<label>What a Yes vote meant<textarea name="yes_means">${h(v.yes_means || "")}</textarea></label>
				<div class="grid"><label>Vote that protects coverage<select name="coverage_side"><option value="yea"${v.coverage_side === "yea" ? " selected" : ""}>Yes</option><option value="nay"${v.coverage_side === "nay" ? " selected" : ""}>No</option></select></label>
				<label>Show on site<select name="hidden"><option value="0"${v.hidden ? "" : " selected"}>Shown</option><option value="1"${v.hidden ? " selected" : ""}>Hidden</option></select></label>
				<label>Source link<input type="url" name="source_url" value="${h(v.source_url || "")}"></label></div>
				<div class="actions"><button class="btn primary small">Save vote</button></div></form></details>` : ""}
		</article>`;
	}).join("");
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>Key health votes</h2><span>119th Congress · recorded roll calls</span></div>
		<p class="lede">The big recorded votes on health coverage in 2025–26, and how every member voted. Newcomers sworn in January 2027 weren't in Congress for these.</p>
		<div class="kvotes-list">${body || `<p class="empty">No key votes yet.</p>`}</div>
		<p class="note">Votes from <a href="https://voteview.com" target="_blank" rel="noopener">Voteview</a>, checked against the official Senate and House Clerk roll calls. Descriptions are written from the official vote text. Totals are the official counts; the name lists and party splits leave out a few members who have since left Congress, and show each member's current party.</p>
	</main>${footer()}`;
}

// ------------------------------------------------------------------ district map (real 2027 boundaries)
let geoP = null;
export async function drawDistricts() {
	const el = document.getElementById("distmap");
	if (!el) return;
	try {
		geoP ??= fetch("/geo/districts.json").then((r) => r.json());
		const [geo] = await Promise.all([geoP, loadD3()]);
		const d3 = window.d3;
		const W = Math.max(el.clientWidth, 600), H = Math.round(W * 0.62);
		const fc = { type: "FeatureCollection", features: geo.states.map((x) => ({ type: "Feature", geometry: x.g })) };
		const proj = d3.geoAlbersUsa().fitSize([W, H], fc);
		const path = d3.geoPath(proj);
		const pool = next120().filter((p) => p.chamber === "house");
		const who = new Map(pool.map((p) => [`${p.state}-${p.district || 0}`, p]));
		const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("class", "dsvg").attr("role", "img").attr("aria-label", "Map of 2027 House districts");
		// Neutral state fills underneath, so slivers between separately simplified districts don't show as holes.
		svg.append("g").selectAll("path").data(geo.states).join("path").attr("d", (d) => path(d.g)).attr("class", "stbase");
		svg.append("g").selectAll("path").data(geo.districts).join("path")
			.attr("d", (d) => path(d.g)).attr("class", "dist")
			.attr("fill", (d) => { const p = who.get(`${d.st}-${d.d}`); return p ? color(p) : "var(--s-unknown)"; })
			.attr("data-id", (d) => who.get(`${d.st}-${d.d}`)?.id || null)
			.attr("data-label", (d) => d.id);
		svg.append("g").selectAll("path").data(geo.states).join("path").attr("d", (d) => path(d.g)).attr("class", "stline");
		el.innerHTML = "";
		el.appendChild(svg.node());
	} catch (e) {
		el.innerHTML = `<p class="note">The district map couldn't load. The state view still works.</p>`;
	}
}

// ------------------------------------------------------------------ state officials for a ZIP
const zsCache = {};
async function zipStateData(zip) {
	const k = zip[0];
	if (!zsCache[k]) { const r = await fetch(`/zipstate/${k}.json`); zsCache[k] = r.ok ? await r.json() : {}; }
	return zsCache[k][zip] || null;
}
async function stateReps(box, zip, st) {
	let hit = null, people = [];
	try { [hit, people] = await Promise.all([zipStateData(zip), api("state/" + encodeURIComponent(st))]); } catch { box.innerHTML = ""; return; }
	const govs = people.filter((p) => p.chamber === "governor" && p.status !== "departing");
	const pick = (kind) => (hit?.[kind] || []).map(([labels, share]) => ({ share, people: people.filter((p) => p.chamber === (kind === "u" ? "state_upper" : "state_lower") && labels.includes(p.sdistrict)) }));
	const upper = pick("u"), lower = pick("l");
	// DC's at-large council members and chair represent every ward.
	const citywide = st === "DC" ? people.filter((p) => p.chamber === "state_upper" && /at.?large|chair/i.test(p.sdistrict || "")) : [];
	const cards = (groups) => groups.flatMap((g) => g.people.map((p) => memberCard(p, zip, g.share))).join("");
	const any = upper.some((g) => g.people.length) || lower.some((g) => g.people.length);
	const name = STATE_NAMES[st] || st;
	box.innerHTML = `<div class="section-title"><h2>Your state officials</h2><span>${h(name)} · <a href="#/state/${h(st)}">all ${h(name)} officials</a></span></div>
		${govs.length ? `<h3 class="mini">${st === "DC" ? "Mayor" : "Governor"}</h3><div class="zipgrid">${govs.map((p) => memberCard(p, zip)).join("")}</div>` : ""}
		${upper.some((g) => g.people.length) || citywide.length ? `<h3 class="mini">${st === "DC" ? "D.C. Council" : st === "NE" ? "Legislature (unicameral)" : "State Senate"}</h3><div class="zipgrid">${cards(upper)}${citywide.map((p) => memberCard(p, zip)).join("")}</div>` : ""}
		${lower.some((g) => g.people.length) ? `<h3 class="mini">State House / Assembly</h3><div class="zipgrid">${cards(lower)}</div>` : ""}
		${!any && !citywide.length ? `<p class="note">We couldn't place this ZIP in a state legislative district. <a href="#/state/${h(st)}">Browse ${h(name)}'s legislators</a> instead.</p>` : ""}
		<p class="note">State districts are matched the same way, from Census 2026 state legislative boundaries; a ZIP that crosses lines lists everyone it touches. Legislators are as seated now (Open States); members elected in November 2026 appear as that data updates. A few New Hampshire "floterial" seats can't be placed by ZIP.</p>`;
}
