import type { ChainedDecisionEventRow } from "./hash-chain.ts";

/**
 * design.md §10.10/SEC-037: merge evidence must be continuously exported to
 * a tamper-resistant store independent of the bot operator's own delete
 * permissions, not left solely in Deno Deploy's own log retention. This file
 * defines the port (`EvidenceSink`) design.md's §3.2 Ports-at-the-edges
 * principle calls for; a real destination (S3 Object Lock bucket, SIEM
 * ingest API, etc.) is a concrete `EvidenceSink` implementation wired in
 * `apps/control` once a destination + credential exists — none does in this
 * sandbox, so only `NullEvidenceSink` (discards; local dev) and
 * `InMemoryEvidenceSink` (captures; tests) ship here.
 */

export interface EvidenceBundleRow extends ChainedDecisionEventRow {
	readonly seq: number;
}

export interface EvidenceBundle {
	readonly bundleId: string;
	readonly generatedAt: string;
	readonly fromSeq: number;
	readonly toSeq: number;
	readonly rows: readonly EvidenceBundleRow[];
}

export interface EvidenceSink {
	export(bundle: EvidenceBundle): Promise<void>;
}

/** design.md §6.7/§10.10: a contiguous range of `decision_event` rows,
 * already hash-chain-verified by the caller, packaged for export. Throws if
 * `rows` is empty or not contiguous by `seq` — an export bundle with gaps
 * would defeat the whole point of exporting it. */
export function buildEvidenceBundle(
	bundleId: string,
	rows: readonly EvidenceBundleRow[],
): EvidenceBundle {
	if (rows.length === 0) throw new Error("buildEvidenceBundle: rows must not be empty");
	const sorted = [...rows].sort((a, b) => a.seq - b.seq);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i]!.seq !== sorted[i - 1]!.seq + 1) {
			throw new Error(
				`buildEvidenceBundle: non-contiguous seq range (gap between ${sorted[i - 1]!.seq} and ${
					sorted[i]!.seq
				})`,
			);
		}
	}
	return {
		bundleId,
		generatedAt: new Date().toISOString(),
		fromSeq: sorted[0]!.seq,
		toSeq: sorted[sorted.length - 1]!.seq,
		rows: sorted,
	};
}

export class NullEvidenceSink implements EvidenceSink {
	export(_bundle: EvidenceBundle): Promise<void> {
		return Promise.resolve();
	}
}

export class InMemoryEvidenceSink implements EvidenceSink {
	readonly exported: EvidenceBundle[] = [];
	export(bundle: EvidenceBundle): Promise<void> {
		this.exported.push(bundle);
		return Promise.resolve();
	}
}
