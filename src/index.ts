// @ts-nocheck
// Who Stands In The Way — API Worker.
// Public read API + password-protected admin API, backed by D1.
// The schema is created and the baseline seed loaded automatically on first request.

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS politicians (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, first TEXT, last TEXT, chamber TEXT NOT NULL, role TEXT,
		state TEXT, district INTEGER, party TEXT, caucus TEXT, voting INTEGER DEFAULT 1, status TEXT DEFAULT 'current',
		term_start TEXT, term_end TEXT, website TEXT, contact_form TEXT, phone TEXT, office TEXT,
		next_election TEXT, twitter TEXT, twitter_alt TEXT, facebook TEXT, instagram TEXT, youtube TEXT, bluesky TEXT, mastodon TEXT,
		opensecrets_id TEXT, fec_ids TEXT, govtrack_id INTEGER, wikipedia TEXT, ballotpedia TEXT, photo_url TEXT, notes TEXT,
		lean TEXT, ideology REAL, lean_note TEXT, lean_source TEXT, phone_label TEXT, offices TEXT, committees TEXT)`,
	`CREATE TABLE IF NOT EXISTS terms (
		politician_id TEXT NOT NULL, congress INTEGER NOT NULL, chamber TEXT, state TEXT, district INTEGER, party TEXT,
		voting INTEGER, role TEXT, PRIMARY KEY (politician_id, congress))`,
	`CREATE TABLE IF NOT EXISTS races (
		id INTEGER PRIMARY KEY AUTOINCREMENT, chamber TEXT, state TEXT, district INTEGER, special INTEGER, pvi TEXT,
		result TEXT, candidates TEXT, winner_id TEXT, exit_polls TEXT)`,
	`CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, rank INTEGER)`,
	`CREATE TABLE IF NOT EXISTS issue_polls (
		id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT NOT NULL, pollster TEXT, date TEXT, stat TEXT, url TEXT, seeded INTEGER DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS issue_positions (
		politician_id TEXT NOT NULL, issue_id TEXT NOT NULL, position TEXT NOT NULL, note TEXT, source_url TEXT, updated_at TEXT,
		PRIMARY KEY (politician_id, issue_id))`,
	`CREATE TABLE IF NOT EXISTS policies (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_primary INTEGER DEFAULT 0, sort INTEGER DEFAULT 0,
		bill_house TEXT, bill_senate TEXT, url TEXT)`,
	`CREATE TABLE IF NOT EXISTS positions (
		politician_id TEXT NOT NULL, policy_id TEXT NOT NULL, stance TEXT NOT NULL, note TEXT, source_url TEXT,
		updated_at TEXT, PRIMARY KEY (politician_id, policy_id))`,
	`CREATE TABLE IF NOT EXISTS outlets (
		id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT, website TEXT, logo_url TEXT,
		contact_url TEXT, notes TEXT)`,
	`CREATE TABLE IF NOT EXISTS appearances (
		id INTEGER PRIMARY KEY AUTOINCREMENT, politician_id TEXT NOT NULL, outlet_id INTEGER, policy_id TEXT,
		date TEXT, title TEXT, clip_url TEXT, signal TEXT, quote TEXT, notes TEXT, created_at TEXT, kind TEXT, post_url TEXT)`,
	`CREATE TABLE IF NOT EXISTS donors (
		id INTEGER PRIMARY KEY AUTOINCREMENT, politician_id TEXT NOT NULL, donor_name TEXT NOT NULL, donor_type TEXT,
		sector TEXT, amount REAL, cycle TEXT, source_url TEXT, notes TEXT)`,
	`CREATE TABLE IF NOT EXISTS finance (politician_id TEXT PRIMARY KEY, as_of TEXT, data TEXT)`,
	`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
	`CREATE INDEX IF NOT EXISTS idx_app_pol ON appearances (politician_id)`,
	`CREATE INDEX IF NOT EXISTS idx_donor_pol ON donors (politician_id)`,
];

const COLS = {
	politicians: ["id", "name", "first", "last", "chamber", "role", "state", "district", "party", "caucus", "voting",
		"status", "term_start", "term_end", "next_election", "website", "contact_form", "phone", "office", "twitter", "twitter_alt",
		"facebook", "instagram", "youtube", "bluesky", "mastodon", "opensecrets_id", "fec_ids", "govtrack_id",
		"wikipedia", "ballotpedia", "photo_url", "notes", "lean", "ideology", "lean_note", "phone_label", "offices", "committees"],
	terms: ["politician_id", "congress", "chamber", "state", "district", "party", "voting", "role"],
	races: ["chamber", "state", "district", "special", "pvi", "result", "candidates", "winner_id", "exit_polls"],
	issues: ["id", "name", "description", "rank"],
	issue_polls: ["issue_id", "pollster", "date", "stat", "url"],
	issue_positions: ["politician_id", "issue_id", "position", "note", "source_url", "updated_at"],
	policies: ["id", "name", "description", "is_primary", "sort", "bill_house", "bill_senate", "url"],
	positions: ["politician_id", "policy_id", "stance", "note", "source_url", "updated_at"],
	outlets: ["name", "kind", "website", "logo_url", "contact_url", "notes"],
	appearances: ["politician_id", "outlet_id", "policy_id", "date", "title", "clip_url", "signal", "quote", "notes", "kind", "post_url"],
	donors: ["politician_id", "donor_name", "donor_type", "sector", "amount", "cycle", "source_url", "notes"],
};
const REQUIRED = {
	politicians: ["id", "name", "chamber"], policies: ["id", "name"], outlets: ["name"],
	appearances: ["politician_id"], donors: ["politician_id", "donor_name"],
	issues: ["id", "name"], issue_polls: ["issue_id", "stat"],
};
const STANCES = ["supports", "public_option", "unclear", "opposes", "unknown"];
// Left/right scale used for a member's overall lean and for their position on each issue.
const SCALE = ["left3", "left2", "left1", "center", "right1", "right2", "right3", "unknown"];

let ready = null;

// Columns added after the first deploy. ALTER fails harmlessly if the column exists.
const MIGRATIONS = [
	"ALTER TABLE politicians ADD COLUMN next_election TEXT",
	"ALTER TABLE appearances ADD COLUMN kind TEXT",
	"ALTER TABLE appearances ADD COLUMN post_url TEXT",
	"ALTER TABLE politicians ADD COLUMN lean TEXT",
	"ALTER TABLE politicians ADD COLUMN ideology REAL",
	"ALTER TABLE politicians ADD COLUMN lean_note TEXT",
	"ALTER TABLE politicians ADD COLUMN lean_source TEXT",
	"ALTER TABLE politicians ADD COLUMN phone_label TEXT",
	"ALTER TABLE politicians ADD COLUMN offices TEXT",
	"ALTER TABLE politicians ADD COLUMN committees TEXT",
];

async function init(db) {
	await db.batch(SCHEMA.map((s) => db.prepare(s)));
	for (const m of MIGRATIONS) await db.prepare(m).run().catch(() => {});
	const seed = (await import("../seed/seed.json")).default;
	const have = await db.prepare("SELECT value FROM meta WHERE key = 'seed_version'").first();
	if (have?.value === seed.version) return;
	// Load or refresh the baseline. Roster and FEC figures are replaced; anything entered by hand
	// (stances you changed, appearances, donors, outlets, policies, people you added) is kept.
	const stmts = [];
	const bulk = (sql, cols, rows, size) => {
		const sel = cols.map((c) => `json_extract(value,'$.${c}')`).join(",");
		for (let i = 0; i < rows.length; i += size) {
			stmts.push(db.prepare(sql.replace("%COLS%", cols.join(",")).replace("%SEL%", sel)).bind(JSON.stringify(rows.slice(i, i + size))));
		}
	};
	const ids = seed.politicians.map((p) => p.id);
	// People in the old baseline who are not in the new one become "former" (hidden from the dashboard, history kept).
	stmts.push(db.prepare("UPDATE politicians SET status = 'former' WHERE id NOT LIKE 'X-%' AND id NOT IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)));
	// A lean you set by hand (lean_source = 'admin') survives refreshes; otherwise the voting-record lean is updated.
	const keepAdmin = (c) => `${c} = CASE WHEN politicians.lean_source = 'admin' THEN politicians.${c} ELSE excluded.${c} END`;
	const upd = COLS.politicians.filter((c) => c !== "id" && c !== "notes")
		.map((c) => (c === "lean" || c === "lean_note" ? keepAdmin(c) : `${c} = excluded.${c}`)).join(", ");
	bulk(`INSERT INTO politicians (%COLS%) SELECT %SEL% FROM json_each(?) WHERE 1 ON CONFLICT (id) DO UPDATE SET ${upd}`, COLS.politicians, seed.politicians, 120);
	bulk("INSERT OR IGNORE INTO policies (%COLS%) SELECT %SEL% FROM json_each(?)", COLS.policies, seed.policies, 100);
	// Seeded stances only fill gaps or replace earlier seeded ones; a stance you edited by hand is never overwritten.
	stmts.push(db.prepare("DELETE FROM positions WHERE note LIKE 'Lead sponsor of %' OR note LIKE 'Original cosponsor of %' OR note LIKE 'Cosponsor of %' OR note LIKE 'Researched Nov 2026:%'"));
	bulk("INSERT OR IGNORE INTO positions (%COLS%) SELECT %SEL% FROM json_each(?)", COLS.positions, seed.positions, 400);
	if (!have) bulk("INSERT INTO outlets (%COLS%) SELECT %SEL% FROM json_each(?)", COLS.outlets, seed.outlets, 100);
	stmts.push(db.prepare("DELETE FROM terms"));
	bulk("INSERT INTO terms (%COLS%) SELECT %SEL% FROM json_each(?)", COLS.terms, seed.terms || [], 300);
	stmts.push(db.prepare("DELETE FROM races"));
	bulk("INSERT INTO races (%COLS%) SELECT %SEL% FROM json_each(?)", COLS.races,
		(seed.races || []).map((r) => ({ ...r, candidates: JSON.stringify(r.candidates), exit_polls: JSON.stringify(r.exit_polls || []) })), 120);
	bulk("INSERT OR IGNORE INTO issues (%COLS%) SELECT %SEL% FROM json_each(?)", COLS.issues, seed.issues || [], 100);
	stmts.push(db.prepare("DELETE FROM issue_polls WHERE seeded = 1"));
	bulk("INSERT INTO issue_polls (%COLS%, seeded) SELECT %SEL%, 1 FROM json_each(?)", COLS.issue_polls, seed.issue_polls || [], 150);
	stmts.push(db.prepare("DELETE FROM finance"));
	bulk("INSERT INTO finance (%COLS%) SELECT %SEL% FROM json_each(?)", ["politician_id", "as_of", "data"], seed.finance.map((f) => ({ ...f, data: JSON.stringify(f.data) })), 60);
	stmts.push(db.prepare("INSERT INTO meta (key, value) VALUES ('seed_version', ?), ('seed_meta', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(seed.version, JSON.stringify(seed.meta || {})));
	await db.batch(stmts);
}

const json = (data, status = 200, headers = {}) =>
	new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status, error) => json({ error }, status);

// ---------------------------------------------------------------- auth
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret, msg) {
	const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function safeEqual(a, b) {
	const [x, y] = await Promise.all([hmac("cmp", a), hmac("cmp", b)]);
	let d = 0;
	for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
	return d === 0;
}
async function makeToken(env) {
	const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
	return `${exp}.${await hmac(env.ADMIN_PASSWORD, `session:${exp}`)}`;
}
async function isAdmin(req, env) {
	if (!env.ADMIN_PASSWORD) return false;
	const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)wsitw=([^;]+)/);
	if (!m) return false;
	const [exp, sig] = m[1].split(".");
	if (!exp || !sig || Number(exp) < Date.now()) return false;
	return safeEqual(sig, await hmac(env.ADMIN_PASSWORD, `session:${exp}`));
}
const cookie = (req, value, maxAge) =>
	`wsitw=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;

// ---------------------------------------------------------------- helpers
const clean = (table, body) => {
	const out = {};
	for (const c of COLS[table]) {
		if (body[c] === undefined) continue;
		let v = body[c];
		if (typeof v === "string") v = v.trim();
		out[c] = v === "" ? null : v;
	}
	return out;
};
const safeUrl = (u) => !u || /^https?:\/\//i.test(u);
const URL_FIELDS = ["post_url", "website", "contact_form", "logo_url", "contact_url", "clip_url", "source_url", "photo_url", "url", "youtube"];
const badUrl = (row) => URL_FIELDS.find((f) => row[f] != null && !safeUrl(String(row[f])));

async function bootstrap(db) {
	const [pols, policies, positions, outlets, apps, meta, terms, issues, polls] = await db.batch([
		db.prepare(`SELECT p.id, p.name, p.last, p.chamber, p.role, p.state, p.district, p.party, p.voting, p.status,
			p.term_end, p.next_election, p.photo_url, p.twitter, p.lean, p.ideology, p.phone, p.phone_label,
			EXISTS (SELECT 1 FROM json_each(COALESCE(p.committees,'[]')) WHERE json_extract(value,'$.health') = 1) AS health_cmte,
			json_extract(f.data,'$.health_total') AS health_total,
			COALESCE(json_extract(f.data,'$.employees.total'),0) AS health_emp,
			json_extract(f.data,'$.totals.receipts') AS receipts,
			json_extract(f.data,'$.totals.pacs') AS pacs,
			COALESCE(json_extract(f.data,'$.outside.support'),0) AS outside_support,
			COALESCE(json_extract(f.data,'$.outside.oppose'),0) AS outside_oppose
			FROM politicians p LEFT JOIN finance f ON f.politician_id = p.id ORDER BY p.last, p.name`),
		db.prepare("SELECT * FROM policies ORDER BY is_primary DESC, sort, name"),
		db.prepare("SELECT politician_id, policy_id, stance, note, source_url, updated_at FROM positions"),
		db.prepare("SELECT * FROM outlets ORDER BY name"),
		db.prepare(`SELECT a.*, o.name AS outlet_name, o.logo_url AS outlet_logo, o.website AS outlet_website
			FROM appearances a LEFT JOIN outlets o ON o.id = a.outlet_id ORDER BY a.date DESC, a.id DESC LIMIT 500`),
		db.prepare("SELECT value FROM meta WHERE key = 'seed_meta'"),
		db.prepare("SELECT * FROM terms"),
		db.prepare("SELECT * FROM issues ORDER BY rank, name"),
		db.prepare("SELECT * FROM issue_polls ORDER BY date DESC"),
	]);
	return { meta: JSON.parse(meta.results[0]?.value || "{}"), terms: terms.results, issues: issues.results,
		issue_polls: polls.results, scale: SCALE, politicians: pols.results, policies: policies.results, positions: positions.results,
		outlets: outlets.results, appearances: apps.results, stances: STANCES };
}

async function profile(db, id) {
	const [p, pos, apps, donors, fin, ipos, terms] = await db.batch([
		db.prepare("SELECT * FROM politicians WHERE id = ?").bind(id),
		db.prepare("SELECT * FROM positions WHERE politician_id = ?").bind(id),
		db.prepare(`SELECT a.*, o.name AS outlet_name, o.logo_url AS outlet_logo, o.website AS outlet_website
			FROM appearances a LEFT JOIN outlets o ON o.id = a.outlet_id WHERE a.politician_id = ? ORDER BY a.date DESC, a.id DESC`).bind(id),
		db.prepare("SELECT * FROM donors WHERE politician_id = ? ORDER BY amount DESC").bind(id),
		db.prepare("SELECT as_of, data FROM finance WHERE politician_id = ?").bind(id),
		db.prepare("SELECT * FROM issue_positions WHERE politician_id = ?").bind(id),
		db.prepare("SELECT * FROM terms WHERE politician_id = ? ORDER BY congress").bind(id),
	]);
	if (!p.results.length) return null;
	const f = fin.results[0];
	return { politician: p.results[0], positions: pos.results, appearances: apps.results, donors: donors.results,
		issue_positions: ipos.results, terms: terms.results,
		finance: f ? { as_of: f.as_of, ...JSON.parse(f.data) } : null };
}

async function admin(req, env, parts) {
	const db = env.DB;
	const [table, id] = parts;
	const method = req.method;
	const body = method === "DELETE" ? {} : await req.json().catch(() => ({}));

	if (table === "positions" && method === "PUT") {
		const row = clean("positions", body);
		if (!row.politician_id || !row.policy_id || !STANCES.includes(row.stance)) return fail(400, "politician_id, policy_id and a valid stance are required");
		if (badUrl(row)) return fail(400, "Links must start with http:// or https://");
		await db.prepare(`INSERT INTO positions (politician_id, policy_id, stance, note, source_url, updated_at)
			VALUES (?,?,?,?,?,?) ON CONFLICT (politician_id, policy_id) DO UPDATE SET
			stance = excluded.stance, note = excluded.note, source_url = excluded.source_url, updated_at = excluded.updated_at`)
			.bind(row.politician_id, row.policy_id, row.stance, row.note ?? null, row.source_url ?? null, new Date().toISOString().slice(0, 10)).run();
		return json({ ok: true });
	}
	if (table === "issue_positions" && method === "PUT") {
		const row = clean("issue_positions", body);
		if (!row.politician_id || !row.issue_id || !SCALE.includes(row.position)) return fail(400, "politician_id, issue_id and a valid position are required");
		if (badUrl(row)) return fail(400, "Links must start with http:// or https://");
		await db.prepare(`INSERT INTO issue_positions (politician_id, issue_id, position, note, source_url, updated_at)
			VALUES (?,?,?,?,?,?) ON CONFLICT (politician_id, issue_id) DO UPDATE SET
			position = excluded.position, note = excluded.note, source_url = excluded.source_url, updated_at = excluded.updated_at`)
			.bind(row.politician_id, row.issue_id, row.position, row.note ?? null, row.source_url ?? null, new Date().toISOString().slice(0, 10)).run();
		return json({ ok: true });
	}
	if (table === "lean" && method === "PUT" && id) {
		if (!SCALE.includes(body.lean)) return fail(400, "Pick a valid lean");
		const note = typeof body.lean_note === "string" ? body.lean_note.trim() || null : null;
		await db.prepare("UPDATE politicians SET lean = ?, lean_note = ?, lean_source = 'admin' WHERE id = ?").bind(body.lean, note, id).run();
		return json({ ok: true });
	}
	if (!["politicians", "policies", "outlets", "appearances", "donors", "issues", "issue_polls"].includes(table)) return fail(404, "Not found");
	if (table === "politicians") { delete body.lean; delete body.lean_note; delete body.ideology; delete body.offices; delete body.committees; }
	const textKey = table === "politicians" || table === "policies" || table === "issues";

	if (method === "POST") {
		const row = clean(table, body);
		if (table === "issues" && row.rank == null) row.rank = 99;
		if (textKey && !row.id) row.id = (table === "politicians" ? "X-" : "") + String(row.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
		for (const r of REQUIRED[table]) if (row[r] == null) return fail(400, `${r} is required`);
		if (badUrl(row)) return fail(400, "Links must start with http:// or https://");
		if (table === "appearances") row.created_at = new Date().toISOString();
		const keys = Object.keys(row);
		try {
			const res = await db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
				.bind(...keys.map((k) => row[k])).run();
			return json({ ok: true, id: textKey ? row.id : res.meta.last_row_id });
		} catch (e) {
			return fail(409, String(e.message || e).includes("UNIQUE") ? "That ID already exists" : "Could not save");
		}
	}
	if (!id) return fail(400, "Missing id");
	if (method === "PUT") {
		const row = clean(table, body);
		delete row.id;
		if (table === "issue_polls") row.seeded = 0; // an edited baseline poll is yours now; refreshes won't replace it
		if (badUrl(row)) return fail(400, "Links must start with http:// or https://");
		const keys = Object.keys(row);
		if (!keys.length) return fail(400, "Nothing to update");
		for (const r of REQUIRED[table]) if (r !== "id" && r in row && row[r] == null) return fail(400, `${r} is required`);
		await db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...keys.map((k) => row[k]), id).run();
		return json({ ok: true });
	}
	if (method === "DELETE") {
		const stmts = [db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id)];
		if (table === "politicians") {
			for (const t of ["positions", "appearances", "donors", "finance", "issue_positions", "terms"]) stmts.push(db.prepare(`DELETE FROM ${t} WHERE politician_id = ?`).bind(id));
		}
		if (table === "policies") stmts.push(db.prepare("DELETE FROM positions WHERE policy_id = ?").bind(id));
		if (table === "issues") {
			stmts.push(db.prepare("DELETE FROM issue_positions WHERE issue_id = ?").bind(id));
			stmts.push(db.prepare("DELETE FROM issue_polls WHERE issue_id = ?").bind(id));
		}
		if (table === "outlets") stmts.push(db.prepare("UPDATE appearances SET outlet_id = NULL WHERE outlet_id = ?").bind(id));
		await db.batch(stmts);
		return json({ ok: true });
	}
	return fail(405, "Method not allowed");
}

// ---------------------------------------------------------------- share links: /m/<id>
// Link previews (X, Facebook, iMessage...) read these tags; people are sent on to the profile.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STANCE_LINE = {
	supports: "supports Medicare for All", public_option: "backs only a public option, not Medicare for All",
	unclear: "is wishy-washy on Medicare for All", opposes: "opposes Medicare for All",
	unknown: "has no public position on Medicare for All yet",
};
async function sharePage(req, env, id) {
	const origin = new URL(req.url).origin;
	const p = await env.DB.prepare(`SELECT p.id, p.name, p.role, p.state, p.district, p.chamber, p.party, p.phone,
		(SELECT stance FROM positions WHERE politician_id = p.id AND policy_id = 'm4a') AS stance,
		COALESCE(json_extract(f.data,'$.health_total'),0) + COALESCE((SELECT SUM(json_extract(value,'$.health_total'))
			FROM json_each(json_extract(f.data,'$.leadership'))),0) AS health, json_extract(f.data,'$.employees.total') AS emp
		FROM politicians p LEFT JOIN finance f ON f.politician_id = p.id WHERE p.id = ?`).bind(id).first();
	const target = p ? `${origin}/#/p/${encodeURIComponent(p.id)}` : `${origin}/`;
	const where = p ? (p.chamber === "senate" ? `Senator, ${p.state}` : p.chamber === "house" ? `${p.state}-${p.district || "AL"}` : p.role) : "";
	const title = p ? `${p.name} ${STANCE_LINE[p.stance || "unknown"]}` : "Who Stands In The Way";
	const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
	const bits = [];
	if (p && (p.health || 0) > 0) bits.push(`${money(p.health)} from health-industry PACs`);
	if (p && (p.emp || 0) > 0) bits.push(`${money(p.emp)} from health-industry employees`);
	const desc = p ? `${p.party}-${where}. ${bits.join(" · ")}${bits.length ? ". " : ""}${p.phone ? `Call ${p.phone}. ` : ""}See the record and who funds them.`
		: "Where every member of Congress stands on Medicare for All.";
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="profile"><meta property="og:site_name" content="Who Stands In The Way">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + "/m/" + encodeURIComponent(id))}">
<meta property="og:image" content="${esc(origin)}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(origin)}/og.png">
<meta http-equiv="refresh" content="0;url=${esc(target)}"><link rel="canonical" href="${esc(target)}">
</head><body style="font-family:system-ui;background:#111214;color:#f1f0ec;padding:40px">
<p>${esc(title)}. <a style="color:#7fd3c4" href="${esc(target)}">Open the profile</a>.</p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`;
	return new Response(html, { status: p ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}

export default {
	async fetch(req, env) {
		const url = new URL(req.url);
		if (url.pathname.startsWith("/m/")) {
			ready ??= init(env.DB).catch((e) => { ready = null; throw e; });
			await ready;
			return sharePage(req, env, decodeURIComponent(url.pathname.slice(3)).split("/")[0]);
		}
		if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
		try {
			ready ??= init(env.DB).catch((e) => { ready = null; throw e; });
			await ready;
			const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);

			if (parts[0] === "bootstrap" && req.method === "GET") return json(await bootstrap(env.DB));
			if (parts[0] === "races" && req.method === "GET") {
				const r = await env.DB.prepare("SELECT * FROM races ORDER BY chamber DESC, state, district").all();
				return json(r.results.map((x) => ({ ...x, candidates: JSON.parse(x.candidates || "[]"), exit_polls: JSON.parse(x.exit_polls || "[]") })));
			}
			if (parts[0] === "photo" && parts[1] && req.method === "GET") {
				// Same-origin copy of a member's photo so share cards can draw it (some photo hosts send
				// no CORS header on redirects). Only the hosts the baseline uses are fetched.
				const row = await env.DB.prepare("SELECT photo_url FROM politicians WHERE id = ?").bind(parts[1]).first();
				const src = row?.photo_url || "";
				if (!/^https:\/\/(unitedstates\.github\.io|commons\.wikimedia\.org|upload\.wikimedia\.org)\//.test(src)) return fail(404, "No photo");
				const r = await fetch(src, { headers: { "user-agent": "who-stands-in-the-way/1.0" }, cf: { cacheTtl: 86400, cacheEverything: true } });
				const type = r.headers.get("content-type") || "";
				if (!r.ok || !type.startsWith("image/")) return fail(404, "No photo");
				return new Response(r.body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
			}
			if (parts[0] === "politicians" && parts[1] && req.method === "GET") {
				const p = await profile(env.DB, parts[1]);
				return p ? json(p) : fail(404, "Not found");
			}
			if (parts[0] === "me") return json({ admin: await isAdmin(req, env), configured: !!env.ADMIN_PASSWORD });
			if (parts[0] === "login" && req.method === "POST") {
				if (!env.ADMIN_PASSWORD) return fail(503, "Admin password is not configured for this deployment");
				const { password } = await req.json().catch(() => ({}));
				if (typeof password !== "string" || !(await safeEqual(password, env.ADMIN_PASSWORD))) {
					await new Promise((r) => setTimeout(r, 600));
					return fail(401, "Wrong password");
				}
				return json({ ok: true }, 200, { "set-cookie": cookie(req, await makeToken(env), 60 * 60 * 24 * 14) });
			}
			if (parts[0] === "logout" && req.method === "POST") return json({ ok: true }, 200, { "set-cookie": cookie(req, "", 0) });
			if (parts[0] === "admin") {
				if (!(await isAdmin(req, env))) return fail(401, "Sign in required");
				// Same-origin check for state-changing requests.
				const origin = req.headers.get("origin");
				if (origin && origin !== url.origin) return fail(403, "Cross-origin request blocked");
				return await admin(req, env, parts.slice(1));
			}
			return fail(404, "Not found");
		} catch (e) {
			console.error(e);
			return fail(500, "Server error");
		}
	},
};
