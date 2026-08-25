import { createApp } from "./src/app.ts";

const port = Number(Deno.env.get("PORT") ?? "8787");

Deno.serve({ port }, createApp());
