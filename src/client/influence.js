// Money & votes: each industry's PAC and super PAC money next to how members voted on the bills that
// industry lobbied on (scripts/sector_votes.json, each vote sourced). Built by build_seed into meta.influence.
import { S, h, url, money, short, chrome, footer, seatChart } from "./main.js";

const $ = (s) => document.querySelector(s);
const TIER_COLOR = { none: "var(--s-unknown)", lower: "#e8a39d", upper: "#e06a60", top10: "#a3241b" };
const tierOf = (m, cuts) => (m <= 0 ? "none" : m >= cuts[1] ? "top10" : m >= cuts[0] ? "upper" : "lower");
const ORDER = { top10: 0, upper: 1, lower: 2, none: 3 };
const PARTY_ORDER = { D: 0, I: 1, R: 2 };

// Seat map: every member of the chamber, colored by how much of the industry's money they took.
function industryMap(r) {
	const known = new Map(r.members.map((x) => [x[0], x]));
	// The Congress picked on the dashboard (the incoming one by default), like the Medicare for All seat maps.
	const seats = S.data.politicians.filter((p) => p.chamber === r.chamber && p.voting !== 0).map((p) => {
		const m = known.get(p.id), amt = m ? m[1] : 0;
		return { id: p.id, tier: tierOf(amt, r.cuts), amt, party: p.party, last: p.last || p.name };
	}).sort((a, b) => ORDER[a.tier] - ORDER[b.tier] || (PARTY_ORDER[a.party] ?? 1) - (PARTY_ORDER[b.party] ?? 1) || b.amt - a.amt);
	const paid = seats.filter((x) => x.amt > 0).length;
	return seatChart(seats.map((x) => ({ id: x.id, color: TIER_COLOR[x.tier] })), r.chamber === "senate" ? 8 : 12,
		`${label(r.sector)} money in the ${r.chamber === "senate" ? "Senate" : "House"}: ${paid} of ${seats.length} members took it`, String(paid), `of ${seats.length} took its money`);
}

// The members in one money group, with their money and how they voted on this industry's bills.
function tierList(r, t) {
	const name = new Map(S.data.all.map((p) => [p.id, p]));
	const rows = r.members.filter((x) => tierOf(x[1], r.cuts) === t && x[3] >= 2).sort((a, b) => b[1] - a[1] || b[2] / b[3] - a[2] / a[3]);
	if (!rows.length) return "";
	return `<details class="infl-list"><summary>Show all ${rows.length}</summary><table class="t"><tr><th>Member</th><th class="n">Money</th><th class="n">Voted its way</th></tr>
		${rows.map(([id, m, w, c]) => { const p = name.get(id); return p ? `<tr><td><a href="#/p/${h(id)}">${h(p.name)}</a> <span class="party ${h(p.party)}">${h(p.party)}</span></td><td class="n">${m > 0 ? money(m) : "—"}</td><td class="n">${w} of ${c}</td></tr>` : ""; }).join("")}</table></details>`;
}

const TIER = [["none", "Took none of its money"], ["lower", "Took some (lower half)"], ["upper", "Took more (upper half)"], ["top10", "Took the most (top 10%)"]];
const label = (k) => S.data.meta?.industry_labels?.[k] || { pharma: "Drugmakers", insurers: "Insurers and PBMs", hospitals: "Hospitals" }[k] || k;

function industryBlock(rows) {
	const g = rows[0].sector, SV = S.data.meta?.sector_votes || {};
	const votes = Object.values(SV).filter((v) => v.sector === g);
	const side = (v) => (v.industry_side === "yea" ? "Yes" : "No");
	return `<section class="card infl" id="infl-${h(g)}"><h2>${h(label(g))}</h2>
		${rows.map((r) => {
			const tiers = TIER.filter(([t]) => r.tiers[t]);
			return `<h3 class="mini">${r.chamber === "senate" ? "Senate" : "House"} · ${r.votes} vote${r.votes === 1 ? "" : "s"} the industry lobbied on</h3>
			<div class="infl-grid"><div class="infl-map">${industryMap(r)}
				<div class="infl-key">${TIER.map(([t, l]) => `<span><i style="background:${TIER_COLOR[t]}"></i>${h(l.replace(/ \(.*\)/, "").replace("Took ", "").replace(" of its money", ""))}</span>`).join("")}</div></div>
			<div class="infl-bars">${tiers.map(([t, l]) => {
				const x = r.tiers[t], pct = x.pct_with ?? 0;
				return `<div class="infl-tier"><div class="infl-row"><span class="infl-l"><i class="sw" style="background:${TIER_COLOR[t]}"></i>${h(l)}${t === "top10" && r.cuts[1] ? ` <small>(${short(r.cuts[1])}+)</small>` : ""}<br><small>${x.members} members</small></span>
					<span class="infl-bar"><i style="width:${pct}%"></i></span><b>${x.pct_with == null ? "—" : pct + "%"}</b></div>${tierList(r, t)}</div>`;
			}).join("")}<p class="note">Share of their votes that went the industry's way. Open a group to see every member in it.</p></div></div>
			${r.top.length ? `<details><summary>Biggest recipients (${r.chamber === "senate" ? "Senate" : "House"})</summary><table class="t"><tr><th>Member</th><th class="n">Industry money</th><th class="n">Voted its way</th></tr>
				${r.top.map((m) => `<tr><td><a href="#/p/${h(m.id)}">${h(m.name)}</a> <span class="party ${h(m.party)}">${h(m.party)}</span></td><td class="n">${money(m.money)}</td><td class="n">${m.with} of ${m.cast}</td></tr>`).join("")}</table></details>` : ""}`;
		}).join("")}
		<details><summary>The votes and where the industry stood</summary><ul class="mvotes">${votes.map((v) => `<li><a href="${url(v.source_url)}" target="_blank" rel="noopener">${h(v.title)}</a> (${h(v.date)}, ${v.chamber === "senate" ? "Senate" : "House"}): the industry wanted <b>${side(v)}</b>${v.industry_source_url ? ` · <a href="${url(v.industry_source_url)}" target="_blank" rel="noopener">source ↗</a>` : ""}</li>`).join("")}</ul></details>
	</section>`;
}

export function renderInfluence() {
	const inf = S.data.meta?.influence || [], tot = S.data.meta?.industry_totals || {};
	const by = {};
	for (const r of inf) (by[r.sector] ||= []).push(r);
	const totals = Object.entries(tot).sort((a, b) => b[1].house + b[1].senate - (a[1].house + a[1].senate));
	$("#app").innerHTML = `${chrome()}<main class="wrap">
		<h1 class="pageh">Money and votes</h1>
		<p class="lede">Industries spend on Congress to get the votes they want. Here is each industry's money next to how members voted on the bills it lobbied on. Watch how the share of votes going the industry's way changes as the money goes up.</p>
		<section class="card"><h2>Who pays Congress <small>2025-26, PAC gifts plus super PAC spending for members</small></h2>
			<table class="t"><tr><th>Industry</th><th class="n">To the House</th><th class="n">To the Senate</th><th class="n">Members paid</th></tr>
			${totals.map(([k, v]) => `<tr><td>${by[k] || (k === "health" && (by.pharma || by.insurers)) ? `<a href="#infl-${h(k === "health" ? (by.insurers ? "insurers" : "pharma") : k)}" data-jump-infl>${h(label(k))}</a>` : h(label(k))}</td><td class="n">${money(v.house)}</td><td class="n">${money(v.senate)}</td><td class="n">${v.members}</td></tr>`).join("")}</table>
			<p class="note">Industry is tagged from each PAC's name and sponsoring organization in FEC filings; super PACs are tagged when they belong to one industry (for example Fairshake and its affiliates for crypto). Health-industry money is split into drugmakers, insurers and hospitals in the votes below.</p></section>
		${Object.values(by).map(industryBlock).join("")}
		<p class="note">Votes are counted only on roll calls where the industry's side is on record; each one links to the roll call and to where the industry stated its position. Money groups are within each chamber: "top 10%" means the members who took the most of that industry's money. Most industries give mainly to one party's members, so party-line votes are part of this pattern; each member's own record, with every vote, is on their profile.</p>
	</main>${footer()}`;
}

export function bindInfluence() {
	document.addEventListener("click", (e) => {
		const a = e.target.closest("[data-jump-infl]");
		if (!a) return;
		e.preventDefault();
		document.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: "smooth", block: "start" });
	});
}
