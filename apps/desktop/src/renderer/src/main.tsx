import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import "./settings-styles.css";
import "./rightpanel-styles.css";
import "./phase4-styles.css";
import "./installation-styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
