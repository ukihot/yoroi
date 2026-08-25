<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m.policy_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.policy_title()}</h1>
</header>
<p>{m.policy_placeholder()}</p>
