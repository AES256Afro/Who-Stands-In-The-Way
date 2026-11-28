import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "who-stands-in-the-way",
		compatibilityDate: "2026-11-17",
		entrypoint,
		// Served at the custom domain (and www); the workers.dev address keeps working too.
		domains: ["whostandsintheway.com", "www.whostandsintheway.com"],
		workersDev: true, // keep the workers.dev address for health checks and the scheduled refresh
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: ["/api/*", "/m/*", "/p/*", "/changes.xml", "/favicon.svg", "/favicon.ico", "/icon-*", "/apple-touch-icon.png", "/site.webmanifest", "/logo/*"],
		},
		env: {
			DB: bindings.d1({ name: "who-stands-in-the-way" }),
			// The app shell, which /p/<id> serves with that person's link-preview tags.
			ASSETS: bindings.assets(),
			// Admin password. Local: .dev.vars. Production: cf deploy --secrets-file
			ADMIN_PASSWORD: bindings.secret(),
			// X_BEARER_TOKEN (optional) is deliberately not declared: a declared secret is required and would
			// block deploys until it exists. Add it to the secrets file to turn on live X posts on profiles.
		},
	},
});
