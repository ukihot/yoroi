import { assertEquals } from "@std/assert";
import { fetchCompleteTree } from "./tree-fetch.ts";
import type { GitHubAdapter, RepoRef, TreeResponse } from "./adapter.ts";
import { installationId, repositoryId, sha } from "@yoroi/domain";

const repo: RepoRef = {
	installationId: installationId(1),
	repositoryId: repositoryId(1),
	owner: "acme",
	name: "payments-api",
};

function fakeAdapter(treesBySha: Record<string, TreeResponse>): GitHubAdapter {
	return {
		getTreeRecursive: (_repo, treeSha) => Promise.resolve(treesBySha[treeSha]!),
		getBlob: () => Promise.reject(new Error("not needed for this test")),
		compareCommits: () => Promise.reject(new Error("not needed")),
		listPullRequestFiles: () => Promise.reject(new Error("not needed")),
		getPullRequest: () => Promise.reject(new Error("not needed")),
		createCheckRun: () => Promise.reject(new Error("not needed")),
		updateCheckRun: () => Promise.reject(new Error("not needed")),
		createComment: () => Promise.reject(new Error("not needed")),
		updateComment: () => Promise.reject(new Error("not needed")),
		mergePullRequest: () => Promise.reject(new Error("not needed")),
		mintInstallationToken: () => Promise.reject(new Error("not needed")),
		getRateLimitStatus: () => Promise.reject(new Error("not needed")),
	};
}

Deno.test("fetchCompleteTree: truncatedでなければそのまま返す（treeマーカーは除外）", async () => {
	const gh = fakeAdapter({
		root: {
			sha: sha("root"),
			truncated: false,
			entries: [
				{ path: "src", mode: "040000", type: "tree", sha: sha("src-tree") },
				{ path: "src/a.ts", mode: "100644", type: "blob", sha: sha("a") },
			],
		},
	});
	const result = await fetchCompleteTree(gh, repo, sha("root"));
	assertEquals(result.entries.length, 1);
	assertEquals(result.entries[0]?.path, "src/a.ts");
});

Deno.test("fetchCompleteTree: truncatedなら再帰的にsubtreeを解決する (AT-39)", async () => {
	const gh = fakeAdapter({
		root: {
			sha: sha("root"),
			truncated: true,
			entries: [
				{ path: "top.ts", mode: "100644", type: "blob", sha: sha("top") },
				{ path: "big", mode: "040000", type: "tree", sha: sha("big-tree") },
			],
		},
		"big-tree": {
			sha: sha("big-tree"),
			truncated: false,
			entries: [{ path: "inner.ts", mode: "100644", type: "blob", sha: sha("inner") }],
		},
	});
	const result = await fetchCompleteTree(gh, repo, sha("root"));
	const paths = result.entries.map((e) => e.path).sort();
	assertEquals(paths, ["big/inner.ts", "top.ts"]);
});
