// Server-drawn share card (1200x630 PNG) for link previews. Mirrors the browser card in src/client/share.js,
// which crawlers can't run. Satori lays out the card as SVG, resvg turns it into a PNG.
import satori, { init as initSatori } from "satori/standalone";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
// satori 0.18 ships a corrupted yoga.wasm (UTF-8 mangled); this copy is decoded from the base64 build in satori/dist/index.js.
import yogaWasm from "./yoga.wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import serif700 from "./serif-700.bin";
import sans400 from "./sans-400.bin";
import sans600 from "./sans-600.bin";
import sans800 from "./sans-800.bin";

const C = {
	bg: "#111214", panel: "#1a1b1e", ink: "#f1f0ec", ink2: "#b9bbc1", ink3: "#8a8d95", line: "#2f3136",
	supports: "#0e8f7e", public_option: "#b98b00", unclear: "#8a63d2", opposes: "#d8483f", unknown: "#6b6f78",
	D: "#6a9cf0", R: "#ee7a72", I: "#a99fd0",
};
const HEADLINE = {
	supports: "SUPPORTS Medicare for All",
	public_option: "Public option only, NOT Medicare for All",
	unclear: "WISHY-WASHY on Medicare for All",
	opposes: "OPPOSES Medicare for All",
	unknown: "NOT ON RECORD on Medicare for All",
};
const PARTY = { D: "Democrat", R: "Republican", I: "Independent" };
const FONTS = [
	{ name: "Serif", data: serif700, weight: 700, style: "normal" },
	{ name: "Sans", data: sans400, weight: 400, style: "normal" },
	{ name: "Sans", data: sans600, weight: 600, style: "normal" },
	{ name: "Sans", data: sans800, weight: 800, style: "normal" },
];
const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");

// Same wording as seat() in src/client/main.js.
const seat = (p) => (p.chamber === "governor" ? `${p.role}, ${p.state}` : p.chamber === "state_upper" || p.chamber === "state_lower"
	? `${p.state} ${p.chamber === "state_upper" ? "Senate" : p.role === "Assemblymember" ? "Assembly" : p.role === "Delegate" ? "House of Delegates" : "House"}${p.sdistrict ? " District " + p.sdistrict : ""}`
	: p.chamber === "executive" ? p.role : `${p.state}${p.chamber === "house" && p.district ? "-" + p.district : p.chamber === "house" ? "-AL" : ""}`);

// Workers can't compile wasm from bytes, and satori's init only takes bytes. During init, hand its
// instantiate call the precompiled module instead.
async function initYoga() {
	const orig = WebAssembly.instantiate;
	WebAssembly.instantiate = (src, imports) => (src instanceof WebAssembly.Module ? orig(src, imports)
		: orig(yogaWasm, imports).then((instance) => ({ instance, module: yogaWasm })));
	// satori instantiates lazily on its first render, so render once before restoring.
	try {
		await initSatori(new Uint8Array(8));
		await satori(el("div", {}, "."), { width: 10, height: 10, fonts: FONTS });
	} finally { WebAssembly.instantiate = orig; }
}
let wasmReady = null;
const ready = () => (wasmReady ??= Promise.all([initYoga(), initWasm(resvgWasm)]).catch((e) => { wasmReady = null; throw e; }));

// Minimal element builder for satori (it takes React-shaped objects, no JSX needed).
const el = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c != null && c !== false) } });

async function photoData(url) {
	if (!/^https:\/\//.test(url || "")) return null;
	try {
		const r = await fetch(url, { headers: { "user-agent": "who-stands-in-the-way/1.0" }, cf: { cacheTtl: 86400, cacheEverything: true } });
		const type = (r.headers.get("content-type") || "").split(";")[0];
		// resvg draws only PNG and JPEG; anything else falls back to initials.
		if (!r.ok || !/^image\/(png|jpe?g)$/.test(type)) return null;
		const buf = new Uint8Array(await r.arrayBuffer());
		if (buf.length > 3e6) return null;
		let bin = "";
		for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
		return `data:${type};base64,${btoa(bin)}`;
	} catch { return null; }
}

// p: politician row plus stance and finance fields (see cardData in src/index.ts).
export async function renderCard(p, host) {
	await ready();
	const st = HEADLINE[p.stance] ? p.stance : "unknown";
	const photo = p.photo_data || (await photoData(p.photo_url));
	const initials = ((p.first || p.name || "?")[0] + ((p.last || "")[0] || "")).toUpperCase();
	const role = p.chamber === "executive" ? p.role : p.chamber === "governor" ? seat(p) : `${p.role} · ${seat(p)}`;
	const facts = [];
	const donors = p.state_money ? "donors" : "PACs";
	if (p.health > 0) facts.push(`${money(p.health)} from health-industry ${donors}`);
	if (p.emp > 0) facts.push(`${money(p.emp)} from health-industry employees`);
	if (!facts.length && p.raised > 0) facts.push(`${money(p.raised)} raised in ${p.state_money ? "their latest campaign" : "2025-26"}`);
	const ta = (() => { try { return JSON.parse(p.trackaipac || "null"); } catch { return null; } })();
	if ((p.chamber === "house" || p.chamber === "senate") && ta?.status) {
		// Same wording as aipacLine() in src/client/badges.js: Track AIPAC's total first.
		facts.push(ta.status === "funded" && ta.total > 0 ? `Israel lobby total: ${money(ta.total)} (Track AIPAC)`
			: ta.status === "rejects" ? "Rejects AIPAC money (Track AIPAC)" : "No pro-Israel PAC money (Track AIPAC)");
	} else if (p.chamber === "house" || p.chamber === "senate") {
		// Same wording as aipacLine(p, money, { compact: true }) in src/client/badges.js.
		const c = (() => { try { return JSON.parse(p.israel_career || "null"); } catch { return null; } })() || {};
		const bits = [];
		if (c.for > 0) bits.push(`${money(c.for)} from AIPAC and other pro-Israel PACs since ${c.first_cycle - 1}`);
		if (c.vs_opponents > 0) bits.push(`${money(c.vs_opponents)} spent against their opponents`);
		if (c.against > 0) bits.push(`${money(c.against)} spent against them`);
		if (bits.length) facts.push(...bits); else facts.push("No AIPAC or pro-Israel PAC money on record");
	}
	const tight = facts.length > 2 || facts.join("").length > 110;
	const tighter = facts.length > 3;
	const nameSize = p.name.length > 26 ? 44 : p.name.length > 18 ? 50 : 56;
	const src = (st === "unknown" ? "No public position found yet." : "Sources on the profile.")
		+ (p.state_money ? " State campaign finance records." : " FEC data, 2025-26 cycle; Israel lobby total from Track AIPAC.");

	const tree = el("div", { width: 1200, height: 630, flexDirection: "column", background: C.bg, fontFamily: "Sans", color: C.ink },
		el("div", { height: 14, width: 1200, background: C[st] }),
		el("div", { flexDirection: "column", padding: "42px 56px 0 56px", flexGrow: 1 },
			el("div", { fontFamily: "Serif", fontSize: 26, fontWeight: 700 }, "Who Stands", el("span", { color: C.opposes, marginLeft: 8 }, "In The Way")),
			el("div", { marginTop: 30, flexDirection: "row" },
				el("div", { width: 190, height: 228, borderRadius: 18, overflow: "hidden", background: C.panel, alignItems: "center", justifyContent: "center", flexShrink: 0 },
					photo
						? { type: "img", props: { src: photo, width: 190, height: 228, style: { width: 190, height: 228, objectFit: "cover", objectPosition: "center 25%" } } }
						: el("div", { fontSize: 64, fontWeight: 800, color: C.ink3 }, initials)),
				el("div", { flexDirection: "column", marginLeft: 40, width: 858 },
					el("div", { fontFamily: "Serif", fontWeight: 700, fontSize: nameSize, lineHeight: 1.08 }, p.name),
					el("div", { marginTop: 10, fontSize: 26, fontWeight: 600, color: C[p.party] || C.ink2 }, `${PARTY[p.party] || p.party || ""} · ${role}`),
					el("div", { marginTop: 20, background: C[st], borderRadius: 14, padding: "16px 24px", fontSize: HEADLINE[st].length > 34 ? 32 : 40, fontWeight: 800, color: "#ffffff" }, HEADLINE[st]),
					el("div", { flexDirection: "column", marginTop: 22 },
						facts.map((t) => el("div", { fontSize: tighter ? 22 : tight ? 25 : 28, fontWeight: 600, marginBottom: tighter ? 3 : tight ? 5 : 8 }, t)),
						p.phone ? el("div", { fontSize: 30, fontWeight: 600, color: C.supports, marginTop: 4 }, `Call: ${p.phone}`) : null)))),
		el("div", { flexDirection: "column", padding: "0 56px 40px 56px" },
			el("div", { fontSize: 17, color: C.ink3 }, src),
			el("div", { height: 2, background: C.line, marginTop: 10, marginBottom: 12 }),
			el("div", { fontSize: 22, fontWeight: 600, color: C.ink2 }, `Find your members and where they stand: ${host}`)));

	const svg = await satori(tree, { width: 1200, height: 630, fonts: FONTS });
	return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

// ---------------------------------------------------------------- site logo / favicon
// Three marks the admin can switch between (meta key 'logo'). Text is drawn through satori so the SVG
// carries outlines, not font references, and looks the same everywhere. E's stacked words can't be read
// below ~48px, so small sizes of E use A's W.
export const LOGOS = { A: "W monogram", D: "Capitol, blocked", E: "Stacked wordmark" };
const tile = (...children) => el("div", { width: 64, height: 64, borderRadius: 14, background: C.bg, flexDirection: "column",
	alignItems: "center", justifyContent: "center", fontFamily: "Serif", fontWeight: 700 }, ...children);
const LOGO_TREES = {
	A: () => tile(el("div", { fontSize: 42, lineHeight: 1, color: C.ink, marginTop: -2 }, "W"),
		el("div", { width: 40, height: 5, borderRadius: 2, background: C.opposes, marginTop: 4 })),
	E: () => tile(el("div", { fontSize: 12, lineHeight: 1.1, color: C.ink, whiteSpace: "nowrap" }, "WHO"),
		el("div", { fontSize: 12, lineHeight: 1.1, color: C.ink, whiteSpace: "nowrap" }, "STANDS"),
		el("div", { fontSize: 8.5, lineHeight: 1.5, color: C.opposes, whiteSpace: "nowrap", letterSpacing: 0.2 }, "IN THE WAY")),
};
const LOGO_D = `<svg viewBox="0 0 64 64" width="64" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="14" fill="${C.bg}"/>`
	+ `<path d="M32 9 L32 14" stroke="${C.ink}" stroke-width="2.5" stroke-linecap="round"/><path d="M18 34 A14 14 0 0 1 46 34 Z" fill="${C.ink}"/>`
	+ `<rect x="14" y="34" width="36" height="4" fill="${C.ink}"/><rect x="17" y="38" width="3" height="9" fill="${C.ink}"/><rect x="25" y="38" width="3" height="9" fill="${C.ink}"/>`
	+ `<rect x="36" y="38" width="3" height="9" fill="${C.ink}"/><rect x="44" y="38" width="3" height="9" fill="${C.ink}"/><rect x="10" y="49" width="44" height="6" rx="2" fill="${C.opposes}"/></svg>`;

// size: the pixel size it will be shown at (picks E's small fallback); returns SVG text.
export async function logoSvg(choice, size = 512) {
	const k = LOGOS[choice] ? (choice === "E" && size < 48 ? "A" : choice) : "A";
	if (k === "D") return LOGO_D;
	await ready();
	return satori(LOGO_TREES[k](), { width: 64, height: 64, fonts: FONTS });
}

export async function logoPng(choice, size) {
	const svg = await logoSvg(choice, size);
	await ready();
	return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}
