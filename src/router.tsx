import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isTransientNetworkError } from "./lib/nav-diagnostics";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Transient reads (dropped connection, 429/5xx, cold-start timeout)
        // retry automatically instead of surfacing as a page failure.
        retry: (failureCount, error) => failureCount < 2 && isTransientNetworkError(error),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
