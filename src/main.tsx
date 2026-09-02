import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createAppRouter } from "@/app/app-router";
import "@/index.css";

// Mount the React application with its memory-based router.
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The root element is missing from index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
