"use client";

// App-wide React Query provider. Introduced with Route Management (Phase 2a) as the
// data-fetching layer for the route module (query keys, caching, optimistic updates,
// invalidation). Mounted once in the dashboard shell so any client component can use
// the route hooks. Existing plain useEffect fetches elsewhere are unaffected.

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createAppQueryClient } from "@/lib/query/client";

export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createAppQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
