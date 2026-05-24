import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../popup/App";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

// Side panel renders the same App with wide=true so it fills the panel.
createRoot(root).render(
  <StrictMode>
    <App wide={true} />
  </StrictMode>
);
