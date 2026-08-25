import postgres from "postgres";
import { mustGetEnv } from "../env.ts";

/**
 * Applies `migrations/*.sql` in filename order, tracking what's already run
 * in `applied_migration`. Hand-written SQL rather than drizzle-kit generate:
 * drizzle-kit is a Node CLI already wired to the console app's own database
 * (root `drizzle.config.ts`); this Deno app manages its own, separate
 * database's DDL directly (design.md §3.3's `packages/postgres/.../run.ts`
 * task convention).
 */

const sql = postgres(mustGetEnv("DATABASE_URL"), { max: 1 });

async function main() {
	await sql`
		CREATE TABLE IF NOT EXISTS applied_migration (
			filename text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`;

	const dir = new URL("./migrations/", import.meta.url);
	const files = [...Deno.readDirSync(dir)]
		.filter((e) => e.isFile && e.name.endsWith(".sql"))
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
}

try {
	await main();
} finally {
	await sql.end();
}
