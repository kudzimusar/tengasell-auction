"use client";

// Tengasell app shell — header (search + categories + account), sticky footer,
// mobile bottom tab bar. NXS: 44px targets, calm surfaces, keyboard-safe
// search, focus states, reduced motion.

import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  ChevronDown,
  Home,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Radio,
  RadioTower,
  Search,
  Sun,
  Tag,
  User,
  X,
  Gavel,
  Sparkles,
  Heart,
  Globe,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  StatusPill,
  TengaLogo,
} from "@/components/tengasell/ui";
import { useAuth } from "@/lib/tengasell/auth";
import { api } from "@/lib/tengasell/api";
import { formatUSD, formatRelative } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import { useCategories, useNotifications } from "@/lib/tengasell/hooks";
import { useRouter } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";

interface Suggestion {
  id: number;
  title: string;
  current_price: number;
}

function SearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!term.trim()) return;
    const t = setTimeout(() => {
      api.suggest(term).then(setSuggestions).catch(() => setSuggestions([]));
    }, 220);
    return () => clearTimeout(t);
  }, [term]);

  const submit = (value?: string) => {
    const q = (value ?? term).trim();
    if (!q) return;
    setOpen(false);
    inputRef.current?.blur();
    router.navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="relative flex-1 max-w-2xl mx-2">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center rounded-pill border border-border bg-raised overflow-hidden focus-within:border-teal focus-within:ring-2 focus-within:ring-ring/30 transition-all"
      >
        <Search className="size-4 ms-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder="Search auctions — iPhone, solar, Hilux…"
          aria-label="Search auctions"
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-body outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="h-11 px-5 bg-gold text-gold-on text-label font-bold hover:bg-gold-deep transition-colors"
        >
          Search
        </button>
      </form>
      <AnimatePresence>
        {open && term.trim() && suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 top-full mt-1 w-full rounded-card border border-border bg-floating shadow-lg overflow-hidden"
          >
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => submit(s.title.split("—")[0].trim())}
                className="w-full text-start px-4 py-2.5 hover:bg-accent/60 transition-colors flex items-center justify-between gap-3"
              >
                <span className="text-body truncate">{s.title}</span>
                <span className="text-caption text-teal font-bold ts-numeric shrink-0">
                  {formatUSD(s.current_price)}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationsBell() {
  const { user } = useAuth();
  const { data: notifications } = useNotifications(!!user);
  const [open, setOpen] = useState(false);
  const unread = notifications?.filter((n) => !n.read).length ?? 0;

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          if (!open && unread > 0) api.markNotificationsRead().catch(() => {});
        }}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative size-11 grid place-items-center rounded-control hover:bg-accent/60 transition-colors"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 end-1.5 min-w-4 h-4 px-0.5 rounded-full bg-urgent text-white text-[10px] font-bold grid place-items-center ts-numeric">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              className="fixed inset-0 z-40 cursor-default"
              aria-hidden="true"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="absolute z-50 end-0 mt-1 w-[min(92vw,380px)] rounded-card border border-border bg-floating shadow-xl overflow-hidden"
            >
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                <span className="text-label font-bold">Notifications</span>
                <span className="text-caption text-muted-foreground">Live via trade engine</span>
              </div>
              <div className="max-h-96 overflow-y-auto ts-scrollbar">
                {(notifications ?? []).length === 0 && (
                  <p className="px-4 py-8 text-center text-caption text-muted-foreground">
                    No notifications yet — watch an auction to get started.
                  </p>
                )}
                {(notifications ?? []).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setOpen(false);
                        if (n.link) navigateToHash(n.link);
                      }}
                      className={cn(
                        "w-full text-start px-4 py-3 border-b border-border/50 hover:bg-accent/50 transition-colors",
                        !n.read && "bg-gold-soft/30",
                      )}
                    >
                      <span className="block text-label font-semibold text-foreground">
                        {n.title}
                      </span>
                      <span className="block text-caption text-muted-foreground line-clamp-2">
                        {n.body}
                      </span>
                      <span className="block text-caption text-muted-foreground/70 mt-0.5">
                        {formatRelative(n.created_at)}
                      </span>
                    </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  window.location.hash = "#/messages";
                }}
                className="w-full px-4 py-2.5 text-label text-teal font-semibold hover:bg-accent/50 transition-colors border-t border-border"
              >
                Messages & conversations →
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function navigateToHash(to: string) {
  window.location.hash = to.startsWith("#") ? to : `#${to}`;
}

function AccountMenu() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => router.navigate("/signin")}
          className="min-h-11 px-3 sm:px-4 rounded-control text-label font-semibold text-teal hover:bg-accent/60 transition-colors"
        >
          {t("nav.signin")}
        </button>
        <button
          onClick={() => router.navigate("/register")}
          className="hidden min-[380px]:inline-flex shrink-0 items-center justify-center whitespace-nowrap min-h-11 px-3 sm:px-4 leading-none rounded-control text-label font-semibold bg-primary text-primary-foreground shadow-sm hover:opacity-95 hover:shadow active:scale-[.98] transition-all"
        >
          {t("nav.register")}
        </button>
      </div>
    );
  }

  const items: { label: string; to: string; icon: React.ReactNode }[] = [
    { label: t("nav.my"), to: "/my", icon: <User className="size-4" /> },
    { label: t("nav.watchlist"), to: "/my/watchlist", icon: <Heart className="size-4" /> },
    { label: t("nav.bids"), to: "/my/bids", icon: <Gavel className="size-4" /> },
    { label: t("nav.selling"), to: "/my/selling", icon: <Tag className="size-4" /> },
    { label: t("nav.orders"), to: "/orders", icon: <Package className="size-4" /> },
    { label: t("nav.messages"), to: "/messages", icon: <Mail className="size-4" /> },
  ];

  // admins get the Comms Console entry (TUCS admin area, task 11-c)
  if (user.admin) {
    items.unshift({
      label: t("nav.commsConsole"),
      to: "/admin",
      icon: <RadioTower className="size-4" />,
    });
  }

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1.5 min-h-11 px-2 rounded-control hover:bg-accent/60 transition-colors"
        aria-label="Account menu"
      >
        <Avatar username={user.username} size={30} />
        <span className="hidden md:inline text-label font-semibold max-w-24 truncate">
          {user.username}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-all absolute end-0 mt-1 w-56 rounded-card border border-border bg-floating shadow-xl overflow-hidden z-50">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-label font-bold truncate">{user.profile?.display_name ?? user.username}</p>
          <p className="text-caption text-muted-foreground truncate">@{user.username}</p>
        </div>
        {items.map((item) => (
          <button
            key={item.to}
            onClick={() => router.navigate(item.to)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-body hover:bg-accent/60 transition-colors text-start"
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        <button
          onClick={async () => {
            await signOut();
            router.navigate("/");
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-body text-danger hover:bg-danger/10 transition-colors border-t border-border"
        >
          <LogOut className="size-4" />
          {t("nav.signout")}
        </button>
      </div>
    </div>
  );
}

function LanguageAndTheme() {
  const { locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => setLocale(locale === "en" ? "ja" : "en")}
        className="min-h-11 px-2.5 rounded-control hover:bg-accent/60 transition-colors text-label font-bold text-muted-foreground"
        aria-label="Switch language (English / 日本語)"
        title="English / 日本語"
      >
        {locale === "en" ? "EN" : "JP"}
      </button>
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="min-h-11 w-11 grid place-items-center rounded-control hover:bg-accent/60 transition-colors"
        aria-label="Toggle dark mode"
      >
        {theme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
      </button>
    </div>
  );
}

function CategoryBar() {
  const { categories } = useCategoriesSafe();
  const router = useRouter();
  const { route } = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const activeCat = route.segments[0] === "c" ? route.segments[1] : null;

  return (
    <nav
      aria-label="Categories"
      className="border-b border-border bg-section/95 backdrop-blur supports-[backdrop-filter]:bg-section/80"
    >
      <div className="mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1 overflow-x-auto ts-scrollbar">
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 min-h-11 px-3 text-label font-bold text-teal hover:bg-accent/60 rounded-control transition-colors"
          >
            <Menu className="size-4" />
            All
          </button>
          <AnimatePresence>
            {open && (
              <>
                <button className="fixed inset-0 z-40 cursor-default" aria-hidden="true" onClick={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute z-50 start-0 mt-1 w-[min(90vw,420px)] rounded-card border border-border bg-floating shadow-xl p-2 grid grid-cols-2 gap-0.5 max-h-[70vh] overflow-y-auto ts-scrollbar"
                >
                  {categories.map((c) => (
                    <button
                      key={c.slug}
                      onClick={() => {
                        setOpen(false);
                        router.navigate(`/c/${c.slug}`);
                      }}
                      className="text-start px-3 py-2 rounded-control hover:bg-accent/60 transition-colors"
                    >
                      <span className="block text-label font-semibold">{c.name}</span>
                      <span className="block text-caption text-muted-foreground truncate">
                        {c.blurb}
                      </span>
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={() => router.navigate("/events")}
          aria-current={route.segments[0] === "events" ? "page" : undefined}
          className={cn(
            "shrink-0 min-h-11 px-3 rounded-control text-label font-bold whitespace-nowrap hover:bg-teal-tint transition-colors flex items-center gap-1.5",
            route.segments[0] === "events" ? "bg-teal-tint text-teal-deep" : "text-teal",
          )}
        >
          <Gavel className="size-4" aria-hidden /> Auction Hub
        </button>
        {categories.slice(0, 8).map((c) => (
          <button
            key={c.slug}
            onClick={() => router.navigate(`/c/${c.slug}`)}
            className={cn(
              "shrink-0 min-h-11 px-3 rounded-control text-label font-semibold whitespace-nowrap hover:bg-accent/60 transition-colors",
              activeCat === c.slug && "text-teal bg-accent",
            )}
          >
            {c.name}
          </button>
        ))}
        <button
          onClick={() => router.navigate("/search?ending=60")}
          className="shrink-0 min-h-11 px-3 rounded-control text-label font-semibold text-urgent whitespace-nowrap hover:bg-urgent/10 transition-colors"
        >
          ⚡ Ending soon
        </button>
        <button
          onClick={() => router.navigate("/assistant")}
          className="shrink-0 min-h-11 px-3 rounded-control text-label font-semibold text-gold-deep whitespace-nowrap hover:bg-gold-soft/40 transition-colors flex items-center gap-1"
        >
          <Sparkles className="size-3.5" /> Tenga AI
        </button>
        <button
          onClick={() => router.navigate("/live")}
          className="shrink-0 min-h-11 px-3 rounded-control text-label font-semibold text-teal-deep whitespace-nowrap hover:bg-teal-tint transition-colors flex items-center gap-1"
        >
          <Radio className="size-3.5 animate-pulse" aria-hidden /> {t("nav.live")}
        </button>
        <button
          onClick={() => router.navigate("/developers")}
          className="shrink-0 min-h-11 px-3 rounded-control text-label font-semibold text-muted-foreground whitespace-nowrap hover:bg-accent/60 transition-colors hidden lg:flex items-center gap-1"
        >
          <Globe className="size-3.5" /> Developers
        </button>
      </div>
    </nav>
  );
}

function useCategoriesSafe() {
  return useCategories();
}

function MobileTabBar() {
  const { route, navigate } = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const tabs = [
    { key: "/", label: t("nav.home"), icon: <Home className="size-5" /> },
    { key: "/search", label: "Search", icon: <Search className="size-5" /> },
    { key: "/sell/new", label: t("nav.sell"), icon: <Tag className="size-5" />, primary: true },
    { key: "/messages", label: t("nav.messages"), icon: <MessageSquare className="size-5" /> },
    {
      key: user ? "/my" : "/signin",
      label: user ? t("nav.my") : t("nav.signin"),
      icon: <User className="size-5" />,
    },
  ];
  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-section/95 backdrop-blur border-t border-border ts-safe-bottom"
    >
      <div className="grid grid-cols-5">
        {tabs.map((tab) => {
          const active = route.path === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigate(tab.key)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-h-14 pt-1.5 pb-1 transition-colors",
                active ? "text-teal" : "text-muted-foreground",
                tab.primary && "text-gold-deep",
              )}
              aria-current={active ? "page" : undefined}
            >
              {tab.icon}
              <span className="text-[10px] font-semibold">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  const cols: { title: string; links: { label: string; to: string }[] }[] = [
    {
      title: "Marketplace",
      links: [
        { label: "Browse categories", to: "/search" },
        { label: "Ending soon", to: "/search?ending=60" },
        { label: "Auction Hub & calendar", to: "/events" },
        { label: "Live auction room", to: "/live" },
        { label: "Sell an item", to: "/sell" },
        { label: "Tenga AI assistant", to: "/assistant" },
      ],
    },
    {
      title: "Trust & SLA",
      links: [
        { label: "Buyer protection", to: "/help#protection" },
        { label: "Service level agreements", to: "/help#sla" },
        { label: "Fees", to: "/help#fees" },
        { label: "Payment methods", to: "/help#payments" },
      ],
    },
    {
      title: "Developers & AI",
      links: [
        { label: "REST & MCP docs", to: "/developers" },
        { label: "Audit trail (agents)", to: "/developers#audit" },
        { label: "TrailBase backend", to: "/developers#trailbase" },
        { label: "Status", to: "/developers#status" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About Tengasell", to: "/help#about" },
        { label: "Contact & support", to: "/help#contact" },
        { label: "tengasell.com", to: "/help#about" },
        { label: "Careers", to: "/help#about" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Terms of Service", to: "/policies/tos" },
        { label: "Privacy Policy", to: "/policies/privacy" },
        { label: "Marketplace rules", to: "/policies/rules" },
        { label: "Refund policy", to: "/policies/refunds" },
        { label: "Acceptable use", to: "/policies/aup" },
        { label: "Accessibility", to: "/policies/accessibility" },
      ],
    },
  ];
  return (
    <footer
      // pb clears the mobile bottom tab bar (57px + safe area) so the last
      // footer line is never obscured at scroll end; md has no tab bar.
      className="mt-auto bg-teal-deep text-white/90 pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-0"
    >
      <div className="mx-auto max-w-7xl px-4 py-12 grid gap-10 md:grid-cols-2 lg:grid-cols-6">
        <div className="md:col-span-2 lg:col-span-1">
          <TengaLogo size={38} tagline />
          <p className="text-caption text-white/70 mt-3 max-w-xs leading-relaxed">
            Zimbabwe&apos;s auction marketplace. Bid, win, smile — a snap to your
            happy deal.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {[
              { label: "X", href: "https://x.com/tengasell" },
              { label: "Instagram", href: "https://instagram.com/tengasell" },
              { label: "Facebook", href: "https://facebook.com/tengasell" },
            ].map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/75 hover:border-gold/70 hover:text-gold transition-colors"
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
        {cols.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold/90 mb-3">{col.title}</h3>
            <ul className="space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={`#${l.to}`}
                    className="group inline-flex items-center gap-1.5 text-caption text-white/75 hover:text-white transition-colors"
                  >
                    <span className="h-px w-0 bg-gold transition-all duration-200 group-hover:w-3" aria-hidden />
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto max-w-7xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-caption text-white/60">
          <span>© {year} Tengasell · tengasell.com · All rights reserved.</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-center">
            <span>48h payment SLA</span>·<span>3-day dispatch</span>·
            <span>7-day dispute window</span>·<span>USD settlement</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { mode, engineConnected } = useAuth();
  const [mobileSearch, setMobileSearch] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:start-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-control"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-section/95 backdrop-blur supports-[backdrop-filter]:bg-section/85">
        <div className="mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1 min-h-16">
          <a
            href="#/"
            className="flex items-center min-h-11 px-1 rounded-control"
            aria-label="Tengasell home"
          >
            <TengaLogo size={34} wordmarkClassName="max-[440px]:hidden" />
          </a>
          <div className="hidden sm:flex flex-1 justify-center">
            <SearchBar />
          </div>
          <div className="flex-1 sm:hidden" />
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setMobileSearch(!mobileSearch)}
              className="sm:hidden size-11 grid place-items-center rounded-control hover:bg-accent/60 transition-colors"
              aria-label="Search"
              aria-expanded={mobileSearch}
            >
              {mobileSearch ? <X className="size-5" /> : <Search className="size-5" />}
            </button>
            <LanguageAndTheme />
            <NotificationsBell />
            <AccountMenu />
            <div className="hidden xl:block ms-2">
              <StatusPill mode={mode} engineConnected={engineConnected} />
            </div>
          </div>
        </div>
        {mobileSearch && (
          <div className="sm:hidden border-t border-border px-2 py-2">
            <SearchBar autoFocus />
          </div>
        )}
        <CategoryBar />
      </header>

      {mode === "degraded" && (
        <div role="status" className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-center text-caption font-semibold text-danger">
          Auction service unavailable — browsing is read-only. Bids, listings, offers, checkout and live-room controls are disabled until the canonical service reconnects.
        </div>
      )}

      <main id="main-content" className="flex-1 pb-20 md:pb-0">
        {children}
      </main>

      <Footer />
      <MobileTabBar />
    </div>
  );
}
