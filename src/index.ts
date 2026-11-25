// @ts-nocheck
// Who Stands In The Way — API Worker.
// Public read API + password-protected admin API, backed by D1.
// The schema is created and the baseline seed loaded automatically on first request.

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS politicians (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, first TEXT, last TEXT, chamber TEXT NOT NULL, role TEXT,
		state TEXT, district INTEGER, party TEXT, caucus TEXT, voting INTEGER DEFAULT 1, status TEXT DEFAULT 'current',
		term_start TEXT, term_end TEXT, website TEXT, contact_form TEXT, phone TEXT, office TEXT,
		twitter TEXT, twitter_alt TEXT, facebook TEXT, instagram TEXT, youtube TEXT, bluesky TEXT, mastodon TEXT,
		opensecrets_id TEXT, fec_ids TEXT, govtrack_id INTEGER, wikipedia TEXT, ballotpedia TEXT, photo_url TEXT, notes TEXT)`,
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
		date TEXT, title TEXT, clip_url TEXT, signal TEXT, quote TEXT, notes TEXT, created_at TEXT)`,
	`CREATE TABLE IF NOT EXISTS donors (
		id INTEGER PRIMARY KEY AUTOINCREMENT, politician_id TEXT NOT NULL, donor_name TEXT NOT NULL, donor_type TEXT,
		sector TEXT, amount REAL, cycle TEXT, source_url TEXT, notes TEXT)`,
	`CREATE TABLE IF NOT EXISTS finance (politician_id TEXT PRIMARY KEY, as_of TEXT, data TEXT)`,
	`CREATE INDEX IF NOT EXISTS idx_app_pol ON appearances (politician_id)`,
	`CREATE INDEX IF NOT EXISTS idx_donor_pol ON donors (politician_id)`,
];

const COLS = {
	politicians: ["id", "name", "first", "last", "chamber", "role", "state", "district", "party", "caucus", "voting",
		"status", "term_start", "term_end", "website", "contact_form", "phone", "office", "twitter", "twitter_alt",
		"facebook", "instagram", "youtube", "bluesky", "mastodon", "opensecrets_id", "fec_ids", "govtrack_id",
		"wikipedia", "ballotpedia", "photo_url", "notes"],
	policies: ["id", "name", "description", "is_primary", "sort", "bill_house", "bill_senate", "url"],
	positions: ["politician_id", "policy_id", "stance", "note", "source_url", "updated_at"],
	outlets: ["name", "kind", "website", "logo_url", "contact_url", "notes"],
	appearances: ["politician_id", "outlet_id", "policy_id", "date", "title", "clip_url", "signal", "quote", "notes"],
	donors: ["politician_id", "donor_name", "donor_type", "sector", "amount", "cycle", "source_url", "notes"],
};
const REQUIRED = {
	politicians: ["id", "name", "chamber"], policies: ["id", "name"], outlets: ["name"],
	appearances: ["politician_id"], donors: ["politician_id", "donor_name"],
};
const STANCES = ["supports", "public_option", "unclear", "opposes", "unknown"];

let ready = null;

async function init(db) {
	await db.batch(SCHEMA.map((s) => db.prepare(s)));
	const row = await db.prepare("SELECT COUNT(*) AS n FROM politicians").first();
	if (row.n > 0) return;
	const seed = (await import("../seed/seed.json")).default;
	const stmts = [];
	const bulk = (table, cols, rows, size) => {
		const sel = cols.map((c) => `json_extract(value,'$.${c}')`).join(",");
		for (let i = 0; i < rows.length; i += size) {
			stmts.push(db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(",")}) SELECT ${sel} FROM json_each(?)`)
				.bind(JSON.stringify(rows.slice(i, i + size))));
		}
	};
	bulk("politicians", COLS.politicians, seed.politicians, 150);
	bulk("policies", COLS.policies, seed.policies, 100);
	bulk("positions", COLS.positions, seed.positions, 500);
	bulk("outlets", COLS.outlets, seed.outlets, 100);
	bulk("finance", ["politician_id", "as_of", "data"],
		seed.finance.map((f) => ({ ...f, data: JSON.stringify(f.data) })), 60);
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
const URL_FIELDS = ["website", "contact_form", "logo_url", "contact_url", "clip_url", "source_url", "photo_url", "url", "youtube"];
const badUrl = (row) => URL_FIELDS.find((f) => row[f] != null && !safeUrl(String(row[f])));

async function bootstrap(db) {
	const [pols, policies, positions, outlets, apps] = await db.batch([
		db.prepare(`SELECT p.id, p.name, p.last, p.chamber, p.role, p.state, p.district, p.party, p.voting, p.status,
			p.term_end, p.photo_url, p.twitter,
			json_extract(f.data,'$.health_total') AS health_total,
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
	]);
	return { politicians: pols.results, policies: policies.results, positions: positions.results,
		outlets: outlets.results, appearances: apps.results, stances: STANCES };
}

async function profile(db, id) {
	const [p, pos, apps, donors, fin] = await db.batch([
		db.prepare("SELECT * FROM politicians WHERE id = ?").bind(id),
		db.prepare("SELECT * FROM positions WHERE politician_id = ?").bind(id),
		db.prepare(`SELECT a.*, o.name AS outlet_name, o.logo_url AS outlet_logo, o.website AS outlet_website
			FROM appearances a LEFT JOIN outlets o ON o.id = a.outlet_id WHERE a.politician_id = ? ORDER BY a.date DESC, a.id DESC`).bind(id),
		db.prepare("SELECT * FROM donors WHERE politician_id = ? ORDER BY amount DESC").bind(id),
		db.prepare("SELECT as_of, data FROM finance WHERE politician_id = ?").bind(id),
	]);
	if (!p.results.length) return null;
	const f = fin.results[0];
	return { politician: p.results[0], positions: pos.results, appearances: apps.results, donors: donors.results,
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
	if (!["politicians", "policies", "outlets", "appearances", "donors"].includes(table)) return fail(404, "Not found");
	const textKey = table === "politicians" || table === "policies";

	if (method === "POST") {
		const row = clean(table, body);
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
			for (const t of ["positions", "appearances", "donors", "finance"]) stmts.push(db.prepare(`DELETE FROM ${t} WHERE politician_id = ?`).bind(id));
		}
		if (table === "policies") stmts.push(db.prepare("DELETE FROM positions WHERE policy_id = ?").bind(id));
		if (table === "outlets") stmts.push(db.prepare("UPDATE appearances SET outlet_id = NULL WHERE outlet_id = ?").bind(id));
		await db.batch(stmts);
		return json({ ok: true });
	}
	return fail(405, "Method not allowed");
}

export default {
	async fetch(req, env) {
		const url = new URL(req.url);
		if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
		try {
			ready ??= init(env.DB).catch((e) => { ready = null; throw e; });
			await ready;
			const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);

			if (parts[0] === "bootstrap" && req.method === "GET") return json(await bootstrap(env.DB));
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
