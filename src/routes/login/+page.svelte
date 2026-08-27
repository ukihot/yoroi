<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m.login_title()} — {m.app_name()}</title></svelte:head>

<main class="login">
	<h1>{m.app_name()}</h1>
	<p>{m.login_subtitle()}</p>
	<form method="post" action="?/signInGithub" use:enhance>
		<button type="submit">{m.login_github_button()}</button>
	</form>
</main>

<style>
	.login {
		max-width: 24rem;
		margin: 15vh auto 0;
		text-align: center;
		background: var(--win-surface, #c0c0c0);
		box-shadow:
			var(--win-border-raised-outer, inset -1px -1px #0a0a0a, inset 1px 1px #fff),
			var(--win-border-raised-inner, inset -2px -2px #808080, inset 2px 2px #dfdfdf);
		padding: 2rem 1.5rem;
	}
	button {
		padding: 0.6rem 1.2rem;
		font-weight: bold;
	}
</style>
