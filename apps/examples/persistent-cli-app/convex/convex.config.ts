import { defineApp } from "convex/server";
import codexLocal from "@convex-dev/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
