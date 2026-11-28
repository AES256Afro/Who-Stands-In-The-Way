// Money & votes: each industry's PAC and super PAC money next to how members voted on the bills that
// industry lobbied on (scripts/sector_votes.json, each vote sourced). Built by build_seed into meta.influence.
import { S, h, url, money, short, chrome, footer } from "./main.js";

const $ = (s) => document.querySelector(s);
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
			<div class="infl-bars">${tiers.map(([t, l]) => {
				const x = r.tiers[t], pct = x.pct_with ?? 0;
				return `<div class="infl-row"><span class="infl-l">${h(l)}${t === "top10" && r.cuts[1] ? ` <small>(${short(r.cuts[1])}+)</small>` : ""}<br><small>${x.members} members</small></span>
					<span class="infl-bar"><i style="width:${pct}%"></i></span><b>${x.pct_with == null ? "—" : pct + "%"}</b></div>`;
			}).join("")}<p class="note">Share of their votes that went the industry's way.</p></div>
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
