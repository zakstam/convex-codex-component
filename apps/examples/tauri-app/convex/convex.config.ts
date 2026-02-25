import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-runtime/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
