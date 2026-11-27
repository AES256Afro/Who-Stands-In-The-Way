import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "who-stands-in-the-way",
		compatibilityDate: "2026-11-17",
		entrypoint,
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: ["/api/*", "/m/*"],
		},
		env: {
			DB: bindings.d1({ name: "who-stands-in-the-way" }),
			// Admin password. Local: .dev.vars. Production: cf deploy --secrets-file
			ADMIN_PASSWORD: bindings.secret(),
			// X_BEARER_TOKEN (optional) is deliberately not declared: a declared secret is required and would
			// block deploys until it exists. Add it to the secrets file to turn on live X posts on profiles.
		},
	},
});
