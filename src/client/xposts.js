// "On X" profile section. Nothing from X loads until the visitor asks for it (X's script tracks visitors).
// Shows (1) X posts logged as entries, embedded with X's free single-post widget, and (2) the member's
// latest posts when the site has an X API key (the Worker returns post IDs; the widget renders them).
import { h, url } from "./main.js";

const STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]+|i(?:\/web)?)\/status\/(\d+)/i;
export const xStatusId = (u) => (STATUS.exec(u || "") || [])[1] || null;

let wjs = null;
function loadWidgets() {
	wjs ??= new Promise((res, rej) => {
		const s = document.createElement("script");
		s.src = "https://platform.twitter.com/widgets.js";
		s.async = true;
		s.onload = () => (window.twttr?.ready ? window.twttr.ready(res) : res());
		s.onerror = rej;
		document.head.appendChild(s);
	});
	return wjs;
}
const theme = () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const embed = (id) => `<blockquote class="twitter-tweet" data-theme="${theme()}" data-dnt="true"><a href="https://twitter.com/i/status/${h(id)}">View post on X</a></blockquote>`;

export function xSection(p, appearances) {
	const handles = [p.twitter, ...(p.twitter_alt || "").split(",")].map((s) => (s || "").trim()).filter(Boolean);
	const logged = [...new Set(appearances.flatMap((a) => [xStatusId(a.clip_url), xStatusId(a.post_url)]).filter(Boolean))];
	if (!handles.length && !logged.length) return "";
	return `<h3>On X <small>${logged.length ? `${logged.length} logged post${logged.length === 1 ? "" : "s"}` : ""}</small></h3>
		<div class="xbox" data-xpid="${h(p.id)}" data-xlogged="${h(logged.join(","))}">
			<div class="links">${handles.map((x) => `<a class="btn small" href="${url("https://x.com/" + encodeURIComponent(x))}" target="_blank" rel="noopener">@${h(x)} ↗</a>`).join("")}
				<button type="button" class="btn small primary" data-xload>Show X posts</button></div>
			<p class="note">Loads content from X, which may track you. To add a post here, log an entry and paste the post's link.</p>
			<div class="xposts"></div>
		</div>`;
}

export function bindX() {
	document.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-xload]");
		if (!b) return;
		const box = b.closest(".xbox"), out = box.querySelector(".xposts");
		b.disabled = true; b.textContent = "Loading…";
		const logged = (box.dataset.xlogged || "").split(",").filter(Boolean);
		let live = { configured: false };
		try { live = await fetch(`/api/x/${encodeURIComponent(box.dataset.xpid)}`).then((r) => r.json()); } catch {}
		const latest = (live.posts || []).map((x) => x.id).filter((id) => !logged.includes(id));
		out.innerHTML = `${logged.length ? `<h4 class="mini">Logged by us</h4>${logged.map(embed).join("")}` : ""}
			${latest.length ? `<h4 class="mini">Latest from @${h(live.handle)}</h4>${latest.map(embed).join("")}` : ""}
			${!live.configured ? `<p class="note">${logged.length ? "" : "No posts logged yet. "}A live feed of their latest posts turns on once the site has an X API key.</p>`
				: live.error ? `<p class="note">${h(live.error)}</p>` : !latest.length && !logged.length ? `<p class="note">No recent posts found.</p>` : ""}`;
		if (logged.length || latest.length) {
			try { await loadWidgets(); await window.twttr.widgets.load(out); }
			catch { out.insertAdjacentHTML("beforeend", `<p class="note">X's embed couldn't load (it may be blocked by your browser). The links above open the posts on X.</p>`); }
		}
		b.textContent = "Loaded";
	});
}
