import { createFileRoute, redirect } from "@tanstack/react-router";

// The converter is now the home page — keep the old /convert URL working.
export const Route = createFileRoute("/convert")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
