import { createOctokitAdapter } from "@yoroi/github";
import type { GitHubAdapter } from "@yoroi/github";
import { mustGetEnv } from "../env.ts";

let cached: GitHubAdapter | null = null;

/**
 * Lazily constructed (module-load time never requires live GitHub App
 * credentials — `deno task check`/`deno task test` still work without them)
 * so only code paths that actually call GitHub (webhook/outbox worker,
 * slash commands) need `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` set.
 * `packages/github/src/octokit-adapter.ts`'s own comment already flags that
 * it's built against Octokit's documented surface but not runtime-verified
 * against a live App in this session.
 */
export function getGitHubAdapter(): GitHubAdapter {
	if (!cached) {
		cached = createOctokitAdapter(
			mustGetEnv("GITHUB_APP_ID"),
			mustGetEnv("GITHUB_APP_PRIVATE_KEY"),
		);
	}
	return cached;
}
