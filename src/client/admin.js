import { S, STANCE, STANCE_ORDER, SIGNAL, KIND, h, api, toast, refresh, markDirty, chrome, seat, stanceOf, pill, appHtml } from "./main.js";

const $ = (s, el = document) => el.querySelector(s);
const opt = (v, l, cur) => `<option value="${h(v)}"${String(cur ?? "") === String(v) ? " selected" : ""}>${h(l)}</option>`;
const today = () => new Date().toISOString().slice(0, 10);
const field = (label, name, value = "", type = "text", extra = "") =>
	`<label>${h(label)}<input type="${type}" name="${name}" value="${h(value ?? "")}" ${extra}></label>`;
const area = (label, name, value = "", ph = "") => `<label>${h(label)}<textarea name="${name}" placeholder="${h(ph)}">${h(value ?? "")}</textarea></label>`;
const stanceSelect = (cur, name = "stance") => `<select name="${name}">${STANCE_ORDER.map((s) => opt(s, STANCE[s], cur || "unknown")).join("")}</select>`;
const policySelect = (cur) => `<select name="policy_id">${S.data.policies.map((p) => opt(p.id, p.name, cur ?? S.policy)).join("")}</select>`;
const outletSelect = () => `<select name="outlet_id">${opt("", "— pick an outlet —", "")}${S.data.outlets.map((o) => opt(o.id, o.kind ? `${o.name} (${o.kind})` : o.name, "")).join("")}${opt("__new", "+ Add a new outlet…", "")}</select>`;

function appearanceFields(p) {
	return `${p ? `<input type="hidden" name="politician_id" value="${h(p.id)}">` : `<label>Politician<input type="text" name="politician_pick" list="pols" placeholder="Start typing a name…" required autocomplete="off"></label>`}
		<div class="grid">
			<label>Type<select name="kind">${Object.entries(KIND).map(([k, v]) => opt(k, v, "show")).join("")}</select></label>
			<label>Outlet / where${outletSelect()}</label>
			${field("Date", "date", today(), "date")}
			<label>Policy${policySelect()}</label>
			<label>What they signaled<select name="signal">${opt("", "— not rated —", "")}${Object.entries(SIGNAL).map(([k, v]) => opt(k, v[0], "")).join("")}</select></label>
		</div>
		<div class="grid newoutlet" hidden>
			${field("New outlet name", "new_outlet_name", "", "text", 'placeholder="Rainbow Stars Podcast"')}
			${field("Type", "new_outlet_kind", "", "text", 'placeholder="Podcast" list="kinds"')}
			${field("Website", "new_outlet_website", "", "url", 'placeholder="https://"')}
			${field("Logo image link", "new_outlet_logo", "", "url", 'placeholder="https://"')}
		</div>
		${field("Headline", "title", "", "text", 'placeholder="Asked about Medicare for All on…"')}
		<div class="grid">${field("Link to the clip, quote, vote or post", "clip_url", "", "url", 'placeholder="https://"')}
			${field("Link to your own post about it", "post_url", "", "url", 'placeholder="https://"')}</div>
		${area("What they said", "quote", "", "Quote or close paraphrase")}
		${area("Your notes", "notes")}`;
}

export const adminProfileTools = {
	stance: (p, pl, x) => `<details class="admin"><summary>Edit stance</summary>
		<form class="form" data-form="stance"><input type="hidden" name="politician_id" value="${h(p.id)}"><input type="hidden" name="policy_id" value="${h(pl.id)}">
			<div class="grid"><label>Stance${stanceSelect(x?.stance)}</label>${field("Source link", "source_url", x?.source_url, "url", 'placeholder="https://"')}</div>
			${area("Why — the receipts", "note", x?.note, "e.g. Says 'access to affordable care' but dodged when asked directly")}
			<div class="actions"><button class="btn primary">Save stance</button></div></form></details>`,
	appearance: (p) => `<details class="admin"><summary>+ Log a show, quote, vote or post</summary>
		<form class="form" data-form="appearance">${appearanceFields(p)}<div class="actions"><button class="btn primary">Save appearance</button></div></form></details>`,
	donor: (p) => `<details class="admin"><summary>+ Document a donor</summary>
		<form class="form" data-form="donor"><input type="hidden" name="politician_id" value="${h(p.id)}">
			<div class="grid">${field("Donor", "donor_name", "", "text", "required")}
				${field("Type", "donor_type", "", "text", 'list="dtypes" placeholder="Super PAC"')}
				${field("Industry", "sector", "", "text", 'list="sectors" placeholder="Pharma"')}
				${field("Amount ($)", "amount", "", "number", 'min="0" step="any"')}
				${field("Cycle / year", "cycle", "", "text", 'placeholder="2025-26"')}
				${field("Source link", "source_url", "", "url", 'placeholder="https://"')}</div>
			${area("Notes", "notes")}
			<div class="actions"><button class="btn primary">Save donor</button></div></form></details>`,
	edit: (p) => `<h3>Admin</h3><details class="admin"><summary>Edit profile details</summary>
		<form class="form" data-form="politician-edit" data-id="${h(p.id)}">${personFields(p)}
			<div class="actions"><button class="btn primary">Save profile</button>
			<button type="button" class="btn danger" data-del="politicians" data-delid="${h(p.id)}">Delete this person</button></div></form></details>`,
};

function personFields(p = {}) {
	return `<div class="grid">
			${field("Full name", "name", p.name, "text", "required")}${field("First name", "first", p.first)}${field("Last name", "last", p.last)}
			<label>Chamber<select name="chamber">${opt("house", "House", p.chamber)}${opt("senate", "Senate", p.chamber)}${opt("executive", "Executive", p.chamber)}</select></label>
			${field("Title", "role", p.role ?? "Representative")}${field("State (2 letters)", "state", p.state, "text", 'maxlength="2"')}
			${field("District", "district", p.district, "number", 'min="0"')}
			<label>Party<select name="party">${opt("D", "Democrat", p.party)}${opt("R", "Republican", p.party)}${opt("I", "Independent", p.party)}</select></label>
			<label>Status<select name="status">${opt("current", "Returning member", p.status)}${opt("incoming", "New in 2027", p.status)}${opt("former", "Former (hidden)", p.status)}</select></label>
			<label>Has a vote?<select name="voting">${opt("1", "Yes", p.voting ?? 1)}${opt("0", "No", p.voting ?? 1)}</select></label>
			${field("Term ends", "term_end", p.term_end, "date")}${field("Next election", "next_election", p.next_election, "date")}${field("Phone", "phone", p.phone)}
		</div><div class="grid">
			${field("Official website", "website", p.website, "url")}${field("Contact form", "contact_form", p.contact_form, "url")}${field("Photo link", "photo_url", p.photo_url, "url")}
			${field("Official X handle", "twitter", p.twitter)}${field("Other X handles (comma-separated)", "twitter_alt", p.twitter_alt)}
			${field("Bluesky handle", "bluesky", p.bluesky)}${field("Facebook", "facebook", p.facebook)}${field("Instagram", "instagram", p.instagram)}${field("YouTube link", "youtube", p.youtube, "url")}
			${field("OpenSecrets ID", "opensecrets_id", p.opensecrets_id)}${field("FEC candidate IDs", "fec_ids", p.fec_ids)}
		</div>${area("Notes", "notes", p.notes)}`;
}

// ------------------------------------------------------------------ admin page
export function renderAdmin() {
	const app = $("#app");
	if (!S.admin) {
		app.innerHTML = `${chrome()}<main class="wrap"><form class="form login" data-form="login">
			<h2 style="margin:0;font-family:var(--serif)">Admin sign-in</h2>
			${S.configured ? "" : `<p class="note">No admin password is set for this deployment yet.</p>`}
			${field("Password", "password", "", "password", 'required autocomplete="current-password" autofocus')}
			<div class="actions"><button class="btn primary">Sign in</button></div></form></main>`;
		return;
	}
	const d = S.data, tab = S.adminTab;
	const tabs = [["appearance", "Log an entry"], ["stances", "Stances"], ["issues", "Issues & polls"], ["outlets", "Outlets"], ["policies", "Policies"], ["people", "Add a person"]];
	let body = "";
	if (tab === "appearance") {
		body = `<form class="form" data-form="appearance">${appearanceFields(null)}<div class="actions"><button class="btn primary">Save appearance</button></div></form>
			<div class="section-title"><h2>Recently logged</h2><span>${d.appearances.length} total</span></div>
			<div class="feed">${d.appearances.slice(0, 25).map((a) => appHtml(a)).join("") || `<p class="note">Nothing logged yet. Your first entry will show up on the dashboard.</p>`}</div>`;
	} else if (tab === "stances") {
		body = `<div class="filters" style="position:static"><input type="search" id="sq" placeholder="Search a name or state to change their stance" value="${h(S.sq || "")}">
			<label>Policy ${policySelect(S.policy).replace("<select ", '<select id="policy" ')}</label></div>
			<div id="squick">${stanceRows()}</div>`;
	} else if (tab === "outlets") {
		body = `<details class="admin" open><summary>+ Add an outlet</summary><form class="form" data-form="outlet">${outletFields()}<div class="actions"><button class="btn primary">Add outlet</button></div></form></details>
			${d.outlets.map((o) => `<details class="admin"><summary>${h(o.name)}${o.kind ? ` · ${h(o.kind)}` : ""}</summary><form class="form" data-form="outlet" data-id="${o.id}">${outletFields(o)}
				<div class="actions"><button class="btn primary">Save</button><button type="button" class="btn danger" data-del="outlets" data-delid="${o.id}">Delete</button></div></form></details>`).join("")}`;
	} else if (tab === "policies") {
		body = `<details class="admin" open><summary>+ Add a policy to track</summary><form class="form" data-form="policy">${policyFields()}<div class="actions"><button class="btn primary">Add policy</button></div></form></details>
			${d.policies.map((p) => `<details class="admin"><summary>${h(p.name)}${p.is_primary ? " · primary" : ""}</summary><form class="form" data-form="policy" data-id="${h(p.id)}">${policyFields(p)}
				<div class="actions"><button class="btn primary">Save</button>${p.is_primary ? "" : `<button type="button" class="btn danger" data-del="policies" data-delid="${h(p.id)}">Delete</button>`}</div></form></details>`).join("")}
			<p class="note">Everyone starts as "Not on record" on a new policy. Set stances from the Stances tab or any profile.</p>`;
	} else {
		body = `<p class="note">For anyone missing, such as the winners of the undecided Louisiana seats or a future special election. Set status to "Former" to hide someone without deleting their history.</p>
			<form class="form" data-form="politician-new">${personFields({ status: "incoming", term_end: "2029-01-03", next_election: "2028-11-07" })}<div class="actions"><button class="btn primary">Add person</button></div></form>`;
	}
	app.innerHTML = `${chrome()}<main class="wrap">
		<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join("")}</div>
		${body}
		<datalist id="pols">${d.politicians.map((p) => `<option value="${h(`${p.name} (${p.party}-${seat(p)}) · ${p.id}`)}">`).join("")}</datalist>
		<datalist id="kinds">${[...new Set(d.outlets.map((o) => o.kind).filter(Boolean).concat(["Podcast", "YouTube show", "Newspaper", "Radio"]))].map((k) => `<option value="${h(k)}">`).join("")}</datalist>
		<datalist id="dtypes"><option value="Super PAC"><option value="Industry PAC"><option value="Individual"><option value="Bundler"><option value="Dark money group"><option value="Lobbyist"></datalist>
		<datalist id="sectors"><option value="Pharma"><option value="Insurance"><option value="Hospitals"><option value="Private equity"><option value="Medical devices"></datalist>
	</main>`;
}
const outletFields = (o = {}) => `<div class="grid">${field("Name", "name", o.name, "text", "required")}${field("Type", "kind", o.kind, "text", 'list="kinds" placeholder="Podcast"')}
	${field("Main website", "website", o.website, "url", 'placeholder="https://"')}${field("Contact page", "contact_url", o.contact_url, "url", 'placeholder="https://"')}
	${field("Logo image link", "logo_url", o.logo_url, "url", 'placeholder="https://"')}</div>${area("Notes", "notes", o.notes)}`;
const policyFields = (p = {}) => `<div class="grid">${field("Name", "name", p.name, "text", "required")}${field("House bill", "bill_house", p.bill_house, "text", 'placeholder="H.R.3069"')}
	${field("Senate bill", "bill_senate", p.bill_senate, "text", 'placeholder="S.1506"')}${field("Link", "url", p.url, "url", 'placeholder="https://"')}</div>
	${area("What counts as support", "description", p.description)}`;

function stanceRows() {
	const q = (S.sq || "").trim().toLowerCase();
	const rows = S.data.politicians.filter((p) => !q || `${p.name} ${p.state} ${seat(p)}`.toLowerCase().includes(q)).slice(0, 40);
	return `<table class="t"><tr><th>Name</th><th>Seat</th><th>Now</th><th>Change to</th><th></th></tr>${rows.map((p) => `<tr>
		<td><a href="#/p/${h(p.id)}">${h(p.name)}</a></td><td><span class="party ${h(p.party)}">${h(p.party)}</span> ${h(seat(p))}</td><td>${pill(stanceOf(p.id))}</td>
		<td><select data-quick="${h(p.id)}" aria-label="Stance for ${h(p.name)}">${STANCE_ORDER.map((s) => opt(s, STANCE[s], stanceOf(p.id))).join("")}</select></td>
		<td><a class="btn small" href="#/p/${h(p.id)}">Add receipts</a></td></tr>`).join("")}</table>
		<p class="note">Showing ${rows.length} of ${S.data.politicians.length}. Search to narrow. Changes save immediately; open a profile to add the note and source.</p>`;
}

// ------------------------------------------------------------------ events
async function save(fn, msg, keep = true) {
	try { await fn(); toast(msg); markDirty(); await refresh(keep); } catch (e) { toast(e.message, true); }
}
function formData(form) {
	const o = {};
	for (const [k, v] of new FormData(form)) o[k] = typeof v === "string" ? v.trim() : v;
	return o;
}

export function bindAdmin() {
	document.addEventListener("submit", async (e) => {
		const form = e.target.closest("form[data-form]");
		if (!form) return;
		e.preventDefault();
		const kind = form.dataset.form, b = formData(form), id = form.dataset.id;
		if (kind === "login") {
			try { await api("login", { method: "POST", body: { password: b.password } }); toast("Signed in"); markDirty(); await refresh(); }
			catch (err) { toast(err.message, true); }
			return;
		}
		if (kind === "stance") return save(() => api("admin/positions", { method: "PUT", body: b }), "Stance saved");
		if (kind === "appearance") {
			if (b.politician_pick !== undefined) {
				const pid = b.politician_pick.split(" · ").pop();
				if (!S.data.politicians.some((p) => p.id === pid)) return toast("Pick a politician from the list", true);
				b.politician_id = pid;
			}
			return save(async () => {
				if (b.outlet_id === "__new") {
					if (!b.new_outlet_name) throw new Error("Give the new outlet a name");
					const o = await api("admin/outlets", { method: "POST", body: { name: b.new_outlet_name, kind: b.new_outlet_kind, website: b.new_outlet_website, logo_url: b.new_outlet_logo } });
					b.outlet_id = o.id;
				}
				await api("admin/appearances", { method: "POST", body: b });
			}, "Appearance logged");
		}
		if (kind === "lean") return save(() => api("admin/lean/" + encodeURIComponent(id), { method: "PUT", body: b }), "Lean saved");
		if (kind === "issuepos") return save(() => api("admin/issue_positions", { method: "PUT", body: b }), "Position saved");
		if (kind === "issue") return save(() => api("admin/issues" + (id ? "/" + encodeURIComponent(id) : ""), { method: id ? "PUT" : "POST", body: b }), id ? "Issue saved" : "Issue added");
		if (kind === "poll") return save(() => api("admin/issue_polls" + (id ? "/" + encodeURIComponent(id) : ""), { method: id ? "PUT" : "POST", body: b }), id ? "Poll saved" : "Poll added");
		if (kind === "keyvote") return save(() => api("admin/key_votes/" + encodeURIComponent(id), { method: "PUT", body: { ...b, hidden: b.hidden === "1" } }), "Vote saved");
		if (kind === "donor") return save(() => api("admin/donors", { method: "POST", body: b }), "Donor saved");
		if (kind === "politician-edit") return save(() => api("admin/politicians/" + encodeURIComponent(id), { method: "PUT", body: b }), "Profile saved");
		if (kind === "politician-new") return save(async () => { const r = await api("admin/politicians", { method: "POST", body: b }); location.hash = "#/p/" + encodeURIComponent(r.id); }, "Person added", false);
		if (kind === "outlet" || kind === "policy") {
			const table = kind === "outlet" ? "outlets" : "policies";
			return save(() => api(`admin/${table}${id ? "/" + encodeURIComponent(id) : ""}`, { method: id ? "PUT" : "POST", body: b }), id ? "Saved" : "Added");
		}
	});
	document.addEventListener("click", async (e) => {
		const tab = e.target.closest("[data-tab]");
		if (tab && tab.dataset.tab === "issues") { location.hash = "#/issues"; return; }
		if (tab) { S.adminTab = tab.dataset.tab; renderAdmin(); return; }
		const del = e.target.closest("[data-del]");
		if (del) {
			e.preventDefault();
			e.stopPropagation();
			const what = { issues: "this issue, its polls and every position recorded on it", issue_polls: "this poll", politicians: "this person and everything logged for them", outlets: "this outlet", policies: "this policy and every stance recorded on it", appearances: "this appearance", donors: "this donor entry" }[del.dataset.del];
			if (!confirm(`Delete ${what}? This can't be undone.`)) return;
			const person = del.dataset.del === "politicians";
			if (person) location.hash = "#/";
			await save(() => api(`admin/${del.dataset.del}/${encodeURIComponent(del.dataset.delid)}`, { method: "DELETE" }), "Deleted", !person);
		}
	});
	document.addEventListener("change", (e) => {
		const t = e.target;
		if (t.name === "outlet_id") { const box = $(".newoutlet", t.closest("form")); if (box) box.hidden = t.value !== "__new"; }
		if (t.dataset.quick) {
			const cur = S.pos.get(t.dataset.quick);
			save(() => api("admin/positions", { method: "PUT", body: { politician_id: t.dataset.quick, policy_id: S.policy, stance: t.value, note: cur?.note || "", source_url: cur?.source_url || "" } }), "Stance saved");
		}
		if (t.id === "policy" && location.hash.startsWith("#/admin")) renderAdmin();
	});
	document.addEventListener("input", (e) => {
		if (e.target.id === "sq") { S.sq = e.target.value; $("#squick").innerHTML = stanceRows(); }
	});
}
