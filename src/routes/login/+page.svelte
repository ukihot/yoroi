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
	}
	button {
		padding: 0.6rem 1.2rem;
		font-weight: 600;
	}
</style>
