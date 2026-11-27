// Agendas (priorities, first-day-to-first-year plans, polling, unpopular positions, timeline) and the state focus page (Texas first).
import { S, h, url, api, toast, chrome, footer, pill, avatar, fmtDate, STANCE } from "./main.js";
import { stateName } from "./states.js";

const $ = (s, el = document) => el.querySelector(s);
const HORIZON = [["day1", "Day one"], ["week1", "First week"], ["month1", "First month"], ["first100", "First 100 days"], ["year1", "First year"], ["term", "This term"]];
const STRENGTH = { signature: "Signature issue", strong: "Strongly for", stated: "Stated" };
const AREA = { health: "Health", economy: "Economy", education: "Education", energy: "Energy", water: "Water", immigration: "Immigration", guns: "Guns",
	abortion: "Abortion", democracy: "Democracy", taxes: "Taxes", housing: "Housing", other: "Other" };
const HEALTH = [["m4a", "Medicare for All"], ["medicaid_expansion", "Medicaid expansion"], ["medicare_expansion", "Medicare expansion"]];
const src = (u, label = "Source") => (u ? ` <a href="${url(u)}" target="_blank" rel="noopener">${h(label)} ↗</a>` : "");
const day = (d) => (!d ? "" : /^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDate(d) : /^\d{4}-\d{2}$/.test(d) ? new Date(d + "-15T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : h(d));
const PLATFORM = { x: "X", bluesky: "Bluesky", tv: "TV", web: "Web", legislature: "Legislature", other: "" };

export function timelineHtml(items, who) {
	const rows = [...(items || [])].filter((t) => t.date || t.text).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
	if (!rows.length) return "";
	return `<ol class="tl">${rows.map((t) => `<li><time>${day(t.date)}</time><div>${who ? `<b>${h(t._who)}</b> · ` : ""}${h(t.text)}
		<span class="note">${[t.kind, PLATFORM[t.platform] ?? t.platform].filter(Boolean).map(h).join(" · ")}</span>${src(t.url, "Link")}</div></li>`).join("")}</ol>`;
}

// The profile section. Returns "" when there's nothing (and no admin to add it).
export function agendaHtml(p, a) {
	if (!a && !S.admin) return "";
	if (!a) return `<h3>Agenda & plans</h3><p class="note">Nothing researched yet.</p>${S.admin ? editor(p, null) : ""}`;
	const plans = HORIZON.map(([k, label]) => [label, (a.plans || []).filter((x) => x.horizon === k)]).filter(([, xs]) => xs.length);
	const health = HEALTH.map(([k, label]) => [label, a.health?.[k]]).filter(([, x]) => x && x.stance && x.stance !== "unknown");
	const acc = a.accounts || {};
	return `<h3>Agenda & plans ${a._updated ? `<small>researched ${h(fmtDate(a._updated))}</small>` : ""}</h3>
		${a.summary ? `<p>${h(a.summary)}</p>` : ""}
		<div class="links">${acc.campaign_site ? `<a class="btn small" href="${url(acc.campaign_site)}" target="_blank" rel="noopener">Campaign site ↗</a>` : ""}
			${acc.x ? `<a class="btn small" href="https://x.com/${encodeURIComponent(acc.x.replace(/^@/, ""))}" target="_blank" rel="noopener">X @${h(acc.x.replace(/^@/, ""))} ↗</a>` : ""}
			${acc.bluesky ? `<a class="btn small" href="https://bsky.app/profile/${encodeURIComponent(acc.bluesky.replace(/^@/, ""))}" target="_blank" rel="noopener">Bluesky ↗</a>` : ""}</div>
		${plans.length ? `<h4 class="mini">What they say they'll do first</h4><div class="plans">${plans.map(([label, xs]) => `<div class="plan"><b>${h(label)}</b><ul>${xs.map((x) => `<li>${h(x.text)}${x.confidence === "low" ? ` <span class="tag">unconfirmed</span>` : ""}${src(x.source_url)}</li>`).join("")}</ul></div>`).join("")}</div>` : ""}
		${(a.priorities || []).length ? `<h4 class="mini">Priorities</h4><ul class="prio">${a.priorities.map((x) => `<li><b>${h(x.title)}</b>${x.strength && x.strength !== "stated" ? ` <span class="tag new">${h(STRENGTH[x.strength] || x.strength)}</span>` : ""}${x.area ? ` <span class="tag">${h(AREA[x.area] || x.area)}</span>` : ""}<br>${h(x.detail || "")}${src(x.source_url)}</li>`).join("")}</ul>` : ""}
		${health.length ? `<h4 class="mini">Health care</h4><ul class="prio">${health.map(([label, x]) => `<li><b>${h(label)}:</b> ${pill(x.stance)} ${h(x.note || "")}${src(x.source_url)}</li>`).join("")}</ul>` : ""}
		${(a.polling || []).length ? `<h4 class="mini">What Texans think of their policies</h4><div class="tablewrap"><table class="t"><tr><th>Policy</th><th>Poll</th><th class="n">Support</th><th class="n">Oppose</th></tr>
			${a.polling.map((x) => `<tr><td>${h(x.policy)}</td><td>${x.source_url ? `<a href="${url(x.source_url)}" target="_blank" rel="noopener">${h(x.pollster || "Poll")}</a>` : h(x.pollster || "")}${x.date ? ` · ${day(x.date)}` : ""}${x.population ? `<br><span class="note">${h(x.population)}</span>` : ""}</td><td class="n">${x.support != null ? h(x.support) + "%" : "—"}</td><td class="n">${x.oppose != null ? h(x.oppose) + "%" : "—"}</td></tr>`).join("")}</table></div>` : ""}
		${(a.unpopular || []).length ? `<h4 class="mini">Positions most voters disagree with</h4><ul class="prio">${a.unpopular.map((x) => `<li><b>${h(x.position)}</b><br>${h(x.evidence || "")}${src(x.source_url)}</li>`).join("")}</ul>` : ""}
		${(a.timeline || []).length ? `<h4 class="mini">Timeline <small>${a.timeline.length} dated statements</small></h4>${timelineHtml(a.timeline)}` : ""}
		<p class="note">Researched from their own statements and news coverage, every item linked. Paraphrased; check the link before quoting.</p>
		${S.admin ? editor(p, a) : ""}`;
}

function editor(p, a) {
	const clean = a ? Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith("_"))) : { summary: "", priorities: [], plans: [], health: {}, unpopular: [], polling: [], timeline: [] };
	return `<details class="admin"><summary>Edit agenda (JSON)</summary>
		<form data-agenda="${h(p.id)}"><textarea name="data" rows="14" spellcheck="false">${h(JSON.stringify(clean, null, 2))}</textarea>
		<p class="note">Format: priorities, plans (horizon: day1, week1, month1, first100, year1, term), health, polling, unpopular, timeline. Every link must start with http.${a?._source === "admin" ? " Edited by hand: research refreshes won't overwrite it." : ""}</p>
		<button class="btn small primary">Save agenda</button></form></details>`;
}

export function bindAgenda() {
	document.addEventListener("submit", async (e) => {
		const f = e.target.closest("form[data-agenda]");
		if (!f) return;
		e.preventDefault();
		let data;
		try { data = JSON.parse(f.data.value); } catch (err) { toast("That isn't valid JSON: " + err.message, true); return; }
		try {
			await api("admin/agenda/" + encodeURIComponent(f.dataset.agenda), { method: "PUT", body: JSON.stringify({ data }) });
			toast("Agenda saved");
		} catch (err) { toast(err.message, true); }
	});
}

// ------------------------------------------------------------------ state focus page (#/focus/TX)
const POLICY_LABEL = { medicaid_exp: "Medicaid expansion", medicare_exp: "Medicare expansion" };
const ORDER = (p) => ({ governor: 0, statewide: 1, senate: 2, house: 3, state_upper: 4, state_lower: 5 }[p.chamber] ?? 6);

export async function renderFocus(st) {
	st = (st || "TX").toUpperCase();
	$("#app").innerHTML = `${chrome()}<p class="loading">Loading ${h(stateName(st))}…</p>`;
	let d;
	try { d = await api("focus/" + encodeURIComponent(st)); } catch (e) { $("#app").innerHTML = `${chrome()}<p class="loading">${h(e.message)}</p>`; return; }
	const people = d.agenda.sort((a, b) => ORDER(a) - ORDER(b) || (b.status === "incoming") - (a.status === "incoming") || a.name.localeCompare(b.name));
	const f = (S.focus ||= { who: "", via: "" });
	const all = people.flatMap((p) => (p.data.timeline || []).map((t) => ({ ...t, _who: p.name, _id: p.id })));
	const card = (p) => {
		const a = p.data, first = (a.plans || []).filter((x) => ["day1", "week1", "month1", "first100"].includes(x.horizon));
		return `<article class="fcard"><button class="row" data-id="${h(p.id)}">${avatar(p)}<span><span class="name">${h(p.name)}</span><br>
			<span class="meta"><span class="party ${h(p.party)}">${h(p.party)}</span> · ${h(a.office || p.role || "")}${p.status === "incoming" ? " · takes office 2027" : ""}</span></span></button>
			${a.summary ? `<p>${h(a.summary)}</p>` : ""}
			${(a.priorities || []).length ? `<p class="note"><b>Priorities:</b> ${a.priorities.slice(0, 6).map((x) => h(x.title)).join(" · ")}</p>` : ""}
			${first.length ? `<p class="note"><b>First moves:</b> ${first.slice(0, 3).map((x) => h(x.text)).join(" · ")}</p>` : ""}
			<p class="note">${HEALTH.map(([k, l]) => a.health?.[k]?.stance && a.health[k].stance !== "unknown" ? `${h(l)}: ${h(STANCE[a.health[k].stance] || a.health[k].stance)}` : "").filter(Boolean).join(" · ")}</p>
			<button class="btn small" data-id="${h(p.id)}">Full agenda, polling and timeline</button></article>`;
	};
	const groups = [["Governor and statewide offices", (p) => ["governor", "statewide"].includes(p.chamber)], ["US Senate", (p) => p.chamber === "senate"],
		["US House", (p) => p.chamber === "house"], ["Texas Legislature", (p) => ["state_upper", "state_lower"].includes(p.chamber)]];
	const tracker = Object.keys(POLICY_LABEL).map((pol) => {
		const rows = d.positions.filter((r) => r.policy_id === pol);
		if (!rows.length) return "";
		const by = (lvl) => rows.filter((r) => (lvl === "federal" ? r.level !== "state" : r.level === "state"));
		const block = (title, rs) => {
			if (!rs.length) return "";
			const n = (s) => rs.filter((r) => r.stance === s).length;
			return `<h4 class="mini">${h(title)} <small>${n("supports")} support · ${n("opposes")} oppose${n("unclear") ? ` · ${n("unclear")} unclear` : ""}</small></h4>
				<div class="chips">${rs.sort((a, b) => ["supports", "unclear", "opposes"].indexOf(a.stance) - ["supports", "unclear", "opposes"].indexOf(b.stance) || a.name.localeCompare(b.name))
					.map((r) => `<button class="chip" style="--stance:var(--s-${h(r.stance)})" data-id="${h(r.id)}" title="${h(r.note || "")}"><i class="dot c-${h(r.stance)}"></i>${h(r.name)} <span class="party ${h(r.party)}">${h(r.party)}</span></button>`).join("")}</div>`;
		};
		return `<div class="section-title"><h2>${h(POLICY_LABEL[pol])}</h2><span>Who's on record, and how</span></div>
			${block("Texas Legislature", by("state"))}${block("Texans in Congress and statewide", by("federal"))}`;
	}).join("");
	const opts = people.filter((p) => (p.data.timeline || []).length);
	const draw = () => {
		const via = (t) => (t.platform === "x" || /\/\/(?:x|twitter)\.com\//.test(t.url || "") ? "x" : t.platform === "bluesky" || /bsky\.app/.test(t.url || "") ? "bluesky" : "other");
		const rows = all.filter((t) => (!f.who || t._id === f.who) && (!f.via || via(t) === f.via));
		$("#ftl").innerHTML = timelineHtml(rows, !f.who) || `<p class="empty">No dated statements yet.</p>`;
	};
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<div class="section-title"><h2>${h(stateName(st))} politics</h2><span><a href="#/state/${h(st)}">Legislature</a> · <a href="#/elections/${h(st)}">2026 results</a></span></div>
		<p class="lede">Who takes office in ${h(stateName(st))} in January 2027, what they ran on, what they say they'll do first, how voters feel about it, and where they stand on health coverage.</p>
		${groups.map(([title, test]) => { const xs = people.filter(test); return xs.length ? `<div class="section-title"><h2>${h(title)}</h2><span>${xs.length}</span></div><div class="fgrid">${xs.map(card).join("")}</div>` : ""; }).join("")}
		${tracker}
		<div class="section-title"><h2>Timeline</h2><span>Everyone's dated statements, newest first</span></div>
		<div class="filters" style="position:static"><select id="ftwho"><option value="">Everyone</option>${opts.map((p) => `<option value="${h(p.id)}"${f.who === p.id ? " selected" : ""}>${h(p.name)}</option>`).join("")}</select>
			<select id="ftvia">${[["", "All sources"], ["x", "Posts on X"], ["bluesky", "Posts on Bluesky"], ["other", "News, speeches, votes"]].map(([v, l]) => `<option value="${v}"${f.via === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
		<div id="ftl"></div>
		<p class="note">Researched November 2026 from candidates' own sites, posts, debates and Texas news coverage; every item links to its source. Gaps are filled over time; admins can edit any agenda from the profile.</p>
	</main>${footer()}`;
	draw();
	renderFocus.redraw = draw;
}

export function bindFocus() {
	document.addEventListener("change", (e) => {
		if (e.target.id === "ftwho") { S.focus.who = e.target.value; renderFocus.redraw?.(); }
		if (e.target.id === "ftvia") { S.focus.via = e.target.value; renderFocus.redraw?.(); }
	});
}
