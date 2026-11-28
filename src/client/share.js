// Share cards: a PNG drawn in the browser from the member's live profile, so it always reflects the
// current stance and figures. Landscape (1200x630) for X/Facebook/link previews, square (1080x1080) for
// Instagram. On phones the system share sheet is used when it can take files; otherwise it downloads.
import { S, api, toast, h, STANCE, PARTY, seat } from "./main.js";
import { aipacLine } from "./badges.js";

const COLORS = {
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
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");

export const shareUrl = (id) => `${location.origin}/p/${encodeURIComponent(id)}`;

function loadImage(src) {
	return new Promise((resolve) => {
		if (!src) return resolve(null);
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = src;
		setTimeout(() => resolve(null), 6000);
	});
}

function wrap(ctx, text, maxW) {
	const words = text.split(/\s+/), lines = [];
	let cur = "";
	for (const w of words) {
		const t = cur ? cur + " " + w : w;
		if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
	}
	if (cur) lines.push(cur);
	return lines;
}

function fitFont(ctx, text, family, weight, maxSize, minSize, maxW, maxLines) {
	for (let size = maxSize; size >= minSize; size -= 2) {
		ctx.font = `${weight} ${size}px ${family}`;
		if (wrap(ctx, text, maxW).length <= maxLines) return size;
	}
	return minSize;
}

function roundRect(ctx, x, y, w, hh, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + hh, r);
	ctx.arcTo(x + w, y + hh, x, y + hh, r);
	ctx.arcTo(x, y + hh, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

async function draw(d, square) {
	const p = d.politician, f = d.finance || {};
	const st = (d.positions.find((x) => x.policy_id === "m4a") || {}).stance || "unknown";
	const W = square ? 1080 : 1200, H = square ? 1080 : 630, pad = square ? 72 : 56;
	const c = document.createElement("canvas");
	c.width = W; c.height = H;
	const ctx = c.getContext("2d");
	ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = COLORS[st]; ctx.fillRect(0, 0, W, 14);

	// brand
	ctx.textBaseline = "alphabetic";
	ctx.font = `700 26px ${SERIF}`;
	ctx.fillStyle = COLORS.ink; ctx.fillText("Who Stands", pad, pad + 26);
	const bw = ctx.measureText("Who Stands ").width;
	ctx.fillStyle = COLORS.opposes; ctx.fillText("In The Way", pad + bw, pad + 26);

	// photo
	const ph = square ? 220 : 190, px = pad, py = pad + 56;
	const img = p.photo_url ? await loadImage(`/api/photo/${encodeURIComponent(p.id)}`) : null;
	ctx.save(); roundRect(ctx, px, py, ph, ph * 1.2, 18); ctx.clip();
	ctx.fillStyle = COLORS.panel; ctx.fillRect(px, py, ph, ph * 1.2);
	if (img) {
		const r = Math.max(ph / img.width, (ph * 1.2) / img.height);
		const iw = img.width * r, ih = img.height * r;
		ctx.drawImage(img, px + (ph - iw) / 2, py + (ph * 1.2 - ih) / 4, iw, ih);
	} else {
		ctx.fillStyle = COLORS.ink3; ctx.font = `700 ${ph / 3}px ${SANS}`; ctx.textAlign = "center";
		ctx.fillText(((p.first || p.name || "?")[0] + (p.last || "")[0]).toUpperCase(), px + ph / 2, py + ph * 0.72);
		ctx.textAlign = "left";
	}
	ctx.restore();

	// name + seat
	const tx = px + ph + 40, tw = W - tx - pad;
	const nsize = fitFont(ctx, p.name, SERIF, 700, square ? 64 : 56, 34, tw, 2);
	ctx.font = `700 ${nsize}px ${SERIF}`; ctx.fillStyle = COLORS.ink;
	let y = py + nsize;
	for (const line of wrap(ctx, p.name, tw)) { ctx.fillText(line, tx, y); y += nsize * 1.08; }
	ctx.font = `600 26px ${SANS}`; ctx.fillStyle = COLORS[p.party] || COLORS.ink2;
	const role = p.chamber === "executive" ? p.role : p.chamber === "governor" ? seat(p) : `${p.role} · ${seat(p)}`;
	ctx.fillText(`${PARTY[p.party] || p.party} · ${role}`, tx, y + 8);
	y += 52;

	// stance banner
	const head = HEADLINE[st];
	const by = square ? Math.max(y + 20, py + ph * 1.2 + 40) : y + 6;
	const bx = square ? pad : tx, bwid = square ? W - pad * 2 : tw;
	const hsize = fitFont(ctx, head, SANS, 800, square ? 52 : 40, 26, bwid - 48, 2);
	ctx.font = `800 ${hsize}px ${SANS}`;
	const hl = wrap(ctx, head, bwid - 48);
	const bh = hl.length * hsize * 1.15 + 36;
	ctx.fillStyle = COLORS[st]; roundRect(ctx, bx, by, bwid, bh, 14); ctx.fill();
	ctx.fillStyle = "#ffffff";
	hl.forEach((line, i) => ctx.fillText(line, bx + 24, by + 18 + hsize * (i + 0.9) * 1.1));

	// money + phone
	const lead = (f.leadership || []).reduce((a, l) => a + (l.health_total || 0), 0);
	const pacs = (f.health_total || 0) + lead, emp = f.employees?.total || 0;
	const facts = [];
	if (pacs > 0) facts.push(`${money(pacs)} from health-industry PACs`);
	if (emp > 0) facts.push(`${money(emp)} from health-industry employees`);
	if (!facts.length && f.totals) facts.push(`${money(f.totals.receipts)} raised in 2025–26`);
	const aipac = aipacLine({ ...p, aipac: f.israel?.aipac || null }, money);
	if (aipac) facts.push(aipac);
	let fy = by + bh + (square ? 84 : 46);
	const tight = !square && facts.length > 2;
	ctx.font = `600 ${square ? 42 : tight ? 25 : 28}px ${SANS}`; ctx.fillStyle = COLORS.ink;
	for (const line of facts) {
		for (const l of wrap(ctx, line, square ? W - pad * 2 : tw)) { ctx.fillText(l, square ? pad : tx, fy); fy += square ? 62 : tight ? 33 : 38; }
	}
	if (p.phone) {
		ctx.font = `700 ${square ? 50 : 30}px ${SANS}`; ctx.fillStyle = COLORS.supports;
		ctx.fillText(`Call: ${p.phone}`, square ? pad : tx, fy + (square ? 22 : 4));
	}

	// footer: source note above the rule, site address below (separate lines so they never collide)
	const src = (st === "unknown" ? "No public position found yet." : "Sources on the profile.") + " FEC data, 2025–26 cycle.";
	ctx.font = `400 ${square ? 22 : 17}px ${SANS}`; ctx.fillStyle = COLORS.ink3;
	ctx.fillText(src, pad, H - pad - (square ? 62 : 48));
	ctx.fillStyle = COLORS.line; ctx.fillRect(pad, H - pad - (square ? 44 : 34), W - pad * 2, 2);
	ctx.font = `600 ${square ? 28 : 22}px ${SANS}`; ctx.fillStyle = COLORS.ink2;
	ctx.fillText(`Find your members and where they stand: ${location.host}`, pad, H - pad + 4);
	return c;
}

const slug = (s) => String(s || "member").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function cardCanvas(id, square) {
	return draw(await api("politicians/" + encodeURIComponent(id)), square);
}

export async function shareCard(id, square) {
	let d;
	try { d = await api("politicians/" + encodeURIComponent(id)); } catch (e) { return toast(e.message, true); }
	const canvas = await draw(d, square);
	let blob;
	try { blob = await new Promise((r) => canvas.toBlob(r, "image/png")); } catch { blob = null; }
	if (!blob) return toast("Couldn't make the image in this browser.", true);
	const name = `${slug(d.politician.name)}-medicare-for-all${square ? "-square" : ""}.png`;
	const file = new File([blob], name, { type: "image/png" });
	const text = `Where does ${d.politician.name} stand on Medicare for All? ${shareUrl(id)}`;
	if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
		try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === "AbortError") return; }
	}
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob); a.download = name;
	document.body.appendChild(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	toast("Card downloaded");
}

export const shareButtons = (id) => `<div class="sharebar">
	<button type="button" class="btn small" data-card="${h(id)}">🖼 Share card</button>
	<button type="button" class="btn small" data-card="${h(id)}" data-square="1">Square card</button>
	<button type="button" class="btn small" data-copylink="${h(id)}">🔗 Copy link</button>
</div>`;

export function bindShare() {
	document.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-card]");
		if (b) {
			e.preventDefault(); e.stopPropagation();
			b.disabled = true; const t = b.textContent; b.textContent = "Making card…";
			try { await shareCard(b.dataset.card, !!b.dataset.square); } finally { b.disabled = false; b.textContent = t; }
			return;
		}
		const l = e.target.closest("[data-copylink]");
		if (l) {
			e.preventDefault(); e.stopPropagation();
			try { await navigator.clipboard.writeText(shareUrl(l.dataset.copylink)); toast("Link copied"); }
			catch { toast(shareUrl(l.dataset.copylink)); }
		}
	});
}
