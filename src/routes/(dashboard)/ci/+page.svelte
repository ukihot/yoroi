<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m.ci_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.ci_title()}</h1>
</header>
<p>{m.ci_placeholder()}</p>
