import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AppProviders } from "@/app/app-providers";
import { createAppRouter } from "@/app/app-router";
import "@/index.css";

// Mount the React application with its memory-based router inside the shell providers.
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The root element is missing from index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  </StrictMode>,
);
