"use client";

// Tengasell hash router — single-page app over the `/` route with clear slugs:
//   #/            home
//   #/search?q=   search results
//   #/c/{slug}    category browse
//   #/item/{id}   auction detail
//   #/sell        sell landing  ·  #/sell/new  create listing
//   #/my/...      account pages
//   #/messages    messaging     ·  #/messages/{id}
//   #/orders      orders        ·  #/orders/{id}
//   #/checkout/{auctionId}     buy-now checkout
//   #/signin      #/register
//   #/assistant   AI trade assistant
//   #/developers  API & MCP docs  ·  #/help  SLA, fees, policies
//
// NXS: back navigation restores scroll position and filter/scroll context.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface RouteInfo {
  hash: string;
  /** In-page anchor after a second "#" (e.g. "/help#fees" → "fees"). */
  fragment?: string;
  path: string; // e.g. /item/12
  segments: string[]; // ["item", "12"]
  query: URLSearchParams;
  full: string; // hash without '#'
}

function parseHash(raw: string): RouteInfo {
  const withoutLead = (raw || "").replace(/^#/, "") || "/";
  // A second "#" is an in-page anchor (e.g. "/help#fees"). It must not become
  // part of the route path, otherwise every footer link resolves to 404.
  const [beforeAnchor, fragment = ""] = withoutLead.split("#");
  const full = beforeAnchor || "/";
  const [pathPart, queryPart] = full.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const segments = path.split("/").filter(Boolean);
  return {
    hash: raw,
    path,
    segments,
    query: new URLSearchParams(queryPart || ""),
    full,
    fragment,
  };
}

const RouterContext = createContext<{
  route: RouteInfo;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  back: () => void;
} | null>(null);

// scroll memory per route key (NXS continuity)
const scrollMemory = new Map<string, number>();
const MAX_MEMORY = 60;

// Hydration-safe route boot: server and client first render ALWAYS agree on
// "/"; the real hash syncs before paint on the client (no visible flash,
// no hydration mismatch on deep links like #/item/1020).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function HashRouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<RouteInfo>(() => parseHash("/"));
  const pendingRestore = useRef<number | null>(null);
  const currentKey = useRef<string>(route.full);

  // Sync to the browser's actual hash before first paint (client only).
  useIsomorphicLayoutEffect(() => {
    if (window.location.hash && window.location.hash !== "#/") {
      const next = parseHash(window.location.hash);
      currentKey.current = next.full;
      setRoute(next);
    }
  }, []);

  // remember scroll position of the route we are leaving
  const saveScroll = useCallback((key: string) => {
    scrollMemory.set(key, window.scrollY);
    if (scrollMemory.size > MAX_MEMORY) {
      const first = scrollMemory.keys().next().value;
      if (first !== undefined) scrollMemory.delete(first);
    }
  }, []);

  useEffect(() => {
    const onHashChange = (event: PopStateEvent | HashChangeEvent) => {
      const next = parseHash(window.location.hash);
      const isPop = event instanceof PopStateEvent;
      if (isPop && scrollMemory.has(next.full)) {
        pendingRestore.current = scrollMemory.get(next.full) ?? 0;
      } else {
        pendingRestore.current = 0;
      }
      saveScroll(currentKey.current);
      currentKey.current = next.full;
      setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange as EventListener);
    window.addEventListener("popstate", onHashChange as EventListener);
    return () => {
      window.removeEventListener("hashchange", onHashChange as EventListener);
      window.removeEventListener("popstate", onHashChange as EventListener);
    };
  }, [saveScroll]);

  // restore scroll after render of new route
  useEffect(() => {
    if (pendingRestore.current !== null) {
      const y = pendingRestore.current;
      pendingRestore.current = null;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [route]);

  const navigate = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      const target = to.startsWith("#") ? to : `#${to.startsWith("/") ? to : `/${to}`}`;
      const next = parseHash(target);
      if (next.full === route.full) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      saveScroll(currentKey.current);
      pendingRestore.current = 0;
      if (opts?.replace) {
        window.history.replaceState(null, "", target);
      } else {
        window.history.pushState(null, "", target);
      }
      currentKey.current = next.full;
      setRoute(next);
    },
    [route.full, saveScroll],
  );

  const back = useCallback(() => window.history.back(), []);

  const value = useMemo(() => ({ route, navigate, back }), [route, navigate, back]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within HashRouterProvider");
  return ctx;
}

/** Convenience: navigate on click, keyboard accessible, preserves semantics. */
export function useLinkProps(to: string) {
  const { navigate } = useRouter();
  return {
    href: to.startsWith("#") ? to : `#${to}`,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
