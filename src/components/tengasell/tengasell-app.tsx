"use client";

// Tengasell app — providers + hash-router switch over lazy page modules.
// Only route: `/` (page.tsx). Slugs:
//   #/ #/search #/c/{slug} #/item/{id} #/sell #/sell/new #/signin #/register
//   #/my/{section} #/u/{username} #/messages[/{id}] #/orders[/{id}]
//   #/checkout/{auctionId} #/pay/{reference} #/assistant #/developers #/help
//   #/policies/{key} #/admin/{section} #/live[/{id}] #/events[/{id}]

import { AnimatePresence, motion } from "framer-motion";
import { Component, lazy, Suspense, useEffect, type ReactNode } from "react";
import { AppShell } from "./app-shell";
import { ErrorState, LoadingGrid } from "./ui";
import { AuthProvider, useAuth } from "@/lib/tengasell/auth";
import { demoSweep } from "@/lib/tengasell/api";
import { HashRouterProvider, useRouter } from "@/lib/tengasell/router";
import { I18nProvider } from "@/lib/tengasell/i18n";

const HomePage = lazy(() => import("./pages/home/home-page"));
const BrowsePage = lazy(() => import("./pages/browse/browse-page"));
const ItemPage = lazy(() => import("./pages/item/item-page"));
const SellLandingPage = lazy(() => import("./pages/sell/sell-landing"));
const SellNewPage = lazy(() => import("./pages/sell/sell-new"));
const SignInPage = lazy(() => import("./pages/account/signin"));
const RegisterPage = lazy(() => import("./pages/account/register"));
const MyPage = lazy(() => import("./pages/account/my-page"));
const ProfilePage = lazy(() => import("./pages/account/profile"));
const MessagesPage = lazy(() => import("./pages/messages/messages-page"));
const OrdersPage = lazy(() => import("./pages/orders/orders-page"));
const CheckoutPage = lazy(() => import("./pages/orders/checkout-page"));
const PaynowSandboxPage = lazy(() => import("./pages/pay/paynow-sandbox"));
const AdminPage = lazy(() => import("./pages/admin/admin-page"));
const AssistantPage = lazy(() => import("./pages/assistant/assistant-page"));
const DevelopersPage = lazy(() => import("./pages/developers/developers-page"));
const HelpPage = lazy(() => import("./pages/help/help-page"));
const PoliciesPage = lazy(() => import("./pages/policies/policies-page"));
const LiveRoomPage = lazy(() => import("./pages/live/live-room"));
const AuctionEventsPage = lazy(() => import("./pages/events/auction-events"));
const AuctionOperationsPage = lazy(() => import("./pages/events/auction-operations"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

function PageFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <LoadingGrid count={8} />
    </div>
  );
}

class ErrorBoundaryRoute extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <ErrorState message={this.state.error.message} />
        </div>
      );
    }
    return this.props.children;
  }
}

function useInterval(fn: () => void, ms: number) {
  useEffect(() => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}

function RouteView() {
  const { route } = useRouter();
  // Pages fetch on mount. If they mount while the API is still probing (demo),
  // they keep showing offline-store data even after the probe succeeds. Keying
  // the view by mode forces one remount when demo flips to live, so every page
  // refetches against Trailbase instead of the seed.
  const { mode } = useAuth();
  const seg = route.segments;
  const key = `${route.full}:${mode}`;

  // Deep links such as /help#fees: scroll the section into view once rendered.
  useEffect(() => {
    if (!route.fragment) return;
    const id = route.fragment;
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [route.fragment, key]);

  // demo-mode sweep keeps local auction endings honest
  useInterval(demoSweep, 30_000);

  let content: ReactNode;
  if (seg.length === 0) {
    content = <HomePage />;
  } else {
    switch (seg[0]) {
      case "search":
        content = (
          <BrowsePage
            mode="search"
            q={route.query.get("q") ?? undefined}
            ending={route.query.get("ending") ?? undefined}
          />
        );
        break;
      case "c":
        content = <BrowsePage mode="category" categorySlug={seg[1] ?? ""} />;
        break;
      case "item": {
        const id = Number(seg[1]);
        content = <ItemPage id={id} />;
        break;
      }
      case "sell":
        content = seg[1] === "new" ? <SellNewPage /> : <SellLandingPage />;
        break;
      case "signin":
        content = <SignInPage />;
        break;
      case "register":
        content = <RegisterPage />;
        break;
      case "my": {
        const section = (seg[1] ?? "overview") as
          | "overview"
          | "watchlist"
          | "bids"
          | "selling"
          | "won"
          | "searches"
          | "offers"
          | "communications"
          | "earnings"
          | "tickets"
          | "privacy"
          | "security"
          | "profile";
        content = <MyPage section={section} />;
        break;
      }
      case "u":
        content = <ProfilePage username={seg[1] ?? ""} />;
        break;
      case "messages":
        content = <MessagesPage threadId={seg[1] ? Number(seg[1]) : undefined} />;
        break;
      case "orders":
        content = <OrdersPage orderId={seg[1] ? Number(seg[1]) : undefined} />;
        break;
      case "checkout":
        content = <CheckoutPage auctionId={Number(seg[1])} />;
        break;
      case "pay":
        content = <PaynowSandboxPage reference={seg[1] ?? ""} />;
        break;
      case "admin": {
        const section = (seg[1] ?? "overview") as
          | "overview"
          | "campaigns"
          | "mock"
          | "moderation"
          | "log"
          | "suppression"
          | "ledger"
          | "payouts"
          | "refunds"
          | "invoices"
          | "reconciliation"
          | "tax"
          | "tickets"
          | "reports"
          | "enforcement"
          | "screening"
          | "policies"
          | "privacy"
          | "registers"
          | "incidents"
          | "risk"
          | "compliance"
          | "users"
          | "marketplace"
          | "audit"
          | "health"
          | "analytics"
          | "config";
        content = <AdminPage section={section} />;
        break;
      }
      case "policies":
        content = <PoliciesPage policyKey={seg[1] ?? "tos"} />;
        break;
      case "live":
        content = <LiveRoomPage sessionId={seg[1] ? Number(seg[1]) : undefined} />;
        break;
      case "events":
        content = seg[1] === "operations"
          ? <AuctionOperationsPage />
          : <AuctionEventsPage eventId={seg[1] ? Number(seg[1]) : undefined} />;
        break;
      case "assistant":
        content = <AssistantPage />;
        break;
      case "developers":
        content = <DevelopersPage />;
        break;
      case "help":
        content = <HelpPage />;
        break;
      default:
        content = <NotFoundPage />;
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <ErrorBoundaryRoute>
          <Suspense fallback={<PageFallback />}>{content}</Suspense>
        </ErrorBoundaryRoute>
      </motion.div>
    </AnimatePresence>
  );
}

export function TengasellApp() {
  return (
    <HashRouterProvider>
      <I18nProvider>
        <AuthProvider>
          <AppShell>
            <RouteView />
          </AppShell>
        </AuthProvider>
      </I18nProvider>
    </HashRouterProvider>
  );
}
