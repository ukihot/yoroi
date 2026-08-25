export function mustGetEnv(name: string): string {
	const value = Deno.env.get(name);
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

export function getEnv(name: string, fallback: string): string {
	return Deno.env.get(name) ?? fallback;
}
