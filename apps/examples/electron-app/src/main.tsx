import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL. Set it in apps/examples/electron-app/.env.local.");
}

const client = new ConvexReactClient(convexUrl);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={client}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
);
