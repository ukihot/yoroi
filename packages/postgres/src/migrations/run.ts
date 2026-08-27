import postgres from 'postgres';

/**
 * design.md §3.3's `packages/postgres/src/migrations/run.ts` task
 * convention. Applies `*.sql` in filename order, tracked in
 * `applied_migration`. Hand-written SQL rather than drizzle-kit generate —
 * see packages/postgres's mod.ts-level notes / apps/control/README.md.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1 });
	try {
		await sql`
			CREATE TABLE IF NOT EXISTS applied_migration (
				filename text PRIMARY KEY,
				applied_at timestamptz NOT NULL DEFAULT now()
			)
		`;

		const dir = new URL('./', import.meta.url);
		const files = [...Deno.readDirSync(dir)]
			.filter((e) => e.isFile && e.name.endsWith('.sql'))
			.map((e) => e.name)
			.sort();

		for (const file of files) {
			const already = await sql`SELECT 1 FROM applied_migration WHERE filename = ${file}`;
			if (already.length > 0) {
				console.log(`skip ${file} (already applied)`);
				continue;
			}
			const text = await Deno.readTextFile(new URL(file, dir));
			console.log(`applying ${file}...`);
			await sql.begin(async (tx) => {
				await tx.unsafe(text);
				await tx`INSERT INTO applied_migration (filename) VALUES (${file})`;
			});
			console.log(`applied ${file}`);
		}
	} finally {
		await sql.end();
	}
}

if (import.meta.main) {
	const databaseUrl = Deno.env.get('DATABASE_URL');
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');
	await runMigrations(databaseUrl);
}
