<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { etaConfidenceLabel } from '$lib/yoroi/labels';
	import type { Eta } from '$lib/server/yoroi/types';

	let { eta }: { eta: Eta | null } = $props();
</script>

{#if eta}
	<span class="eta eta-{eta.confidence}">
		{m.eta_range({ from: eta.from, to: eta.to, confidence: etaConfidenceLabel(eta.confidence) })}
	</span>
{:else}
	<span class="eta eta-unknown">{m.eta_unknown()}</span>
{/if}

<style>
	.eta {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.eta-high {
		color: var(--yoroi-status-green, #1a7f37);
	}
	.eta-medium {
		color: var(--yoroi-status-amber, #9a6700);
	}
	.eta-low,
	.eta-unknown {
		color: var(--yoroi-muted, #6e7781);
	}
</style>
