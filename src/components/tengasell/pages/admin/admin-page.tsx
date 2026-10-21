"use client";

// Tengasell — Admin area (#/admin/{section}). MSCS 12 unified shell.
// Auth gate → admin gate → grouped console nav across ALL control planes:
//   Communications (11-c verified) · Finance (12-b) · Support & Trust (12-c)
//   Governance (12-d) · Compliance (12-d) · Platform (12-e).
// Non-admins get a clear "Admins only" state; every admin BFF route enforces
// the same role server-side (401/403). Section content components are
// imported from per-plane console files owned by their build tasks.

import {
  Activity,
  BarChart3,
  ClipboardCheck,
  Database,
  Eye,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogIn,
  Megaphone,
  PackageSearch,
  RadioTower,
  Scale,
  Settings2,
  ShieldAlert,
  ShieldOff,
  ShieldCheck,
  UserX,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LinkButton } from "../account/auth-shared";
import { Avatar, EmptyState } from "@/components/tengasell/ui";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";
import { AdminPageSkeleton, CommsContent, type AdminSection as CommsSection } from "./comms-console";
import { FinanceConsole, type FinanceSection } from "./finance-console";
import { TrustConsole, type TrustSection } from "./trust-console";
import { GovernanceConsole, type GovernanceSection } from "./governance-console";
import { ComplianceConsole } from "./compliance-console";
import {
  AnalyticsConsole,
  AuditConsole,
  ConfigConsole,
  HealthConsole,
  MarketplaceConsole,
  UsersConsole,
} from "./platform-consoles";

export type AdminSection =
  | CommsSection
  | FinanceSection
  | TrustSection
  | GovernanceSection
  | "compliance"
  | "users"
  | "marketplace"
  | "audit"
  | "health"
  | "analytics"
  | "config";

interface NavGroup {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  sections: AdminSection[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: "comms",
    labelKey: "admin.group.comms",
    icon: RadioTower,
    sections: ["overview", "campaigns", "mock", "moderation", "log", "suppression"],
  },
  {
    key: "finance",
    labelKey: "admin.group.finance",
    icon: Wallet,
    sections: ["ledger", "payouts", "refunds", "invoices", "reconciliation", "tax"],
  },
  {
    key: "trust",
    labelKey: "admin.group.trust",
    icon: LifeBuoy,
    sections: ["tickets", "reports", "enforcement", "screening"],
  },
  {
    key: "govern",
    labelKey: "admin.group.govern",
    icon: Scale,
    sections: ["policies", "privacy", "registers", "incidents", "risk"],
  },
  {
    key: "compliance",
    labelKey: "admin.group.compliance",
    icon: ClipboardCheck,
    sections: ["compliance"],
  },
  {
    key: "platform",
    labelKey: "admin.group.platform",
    icon: Settings2,
    sections: ["users", "marketplace", "audit", "health", "analytics", "config"],
  },
];

const ALL_SECTIONS = NAV_GROUPS.flatMap((g) => g.sections);

const SECTION_ICON: Partial<Record<AdminSection, LucideIcon>> = {
  overview: LayoutDashboard,
  campaigns: Megaphone,
  mock: Eye,
  moderation: ShieldAlert,
  log: ListChecks,
  suppression: ShieldOff,
  ledger: Database,
  payouts: Wallet,
  refunds: Wallet,
  invoices: FileText,
  reconciliation: Database,
  tax: FileText,
  tickets: LifeBuoy,
  reports: ShieldAlert,
  enforcement: ShieldOff,
  screening: Eye,
  policies: FileText,
  privacy: ShieldCheck,
  registers: Database,
  incidents: Activity,
  risk: ShieldAlert,
  compliance: ClipboardCheck,
  users: Users,
  marketplace: PackageSearch,
  audit: ListChecks,
  health: Activity,
  analytics: BarChart3,
  config: Settings2,
};

export default function AdminPage({ section }: { section: AdminSection }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return <AdminPageSkeleton />;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <EmptyState
          icon={<UserX className="size-10" />}
          title={t("admin.signinTitle")}
          body={t("admin.signinBody")}
          action={
            <LinkButton to="/signin">
              <LogIn className="size-4" aria-hidden="true" />
              {t("nav.signin")}
            </LinkButton>
          }
        />
      </div>
    );
  }

  if (!user.admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <EmptyState
          icon={<ShieldAlert className="size-10" />}
          title={t("admin.deny.title")}
          body={t("admin.deny.body")}
          action={
            <div className="flex items-center gap-3 justify-center flex-wrap">
              <Avatar username={user.username} size={34} />
              <span className="text-label text-muted-foreground">@{user.username}</span>
            </div>
          }
        />
      </div>
    );
  }

  return <AdminShell user={user} section={section} />;
}

function AdminShell({ user, section }: { user: CurrentUser; section: AdminSection }) {
  const { t } = useI18n();
  const active = ALL_SECTIONS.includes(section) ? section : "overview";
  const group = NAV_GROUPS.find((g) => g.sections.includes(active)) ?? NAV_GROUPS[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-headline text-foreground">{t("admin.title")}</h1>
        <p className="text-caption text-muted-foreground mt-0.5">{t("admin.sub")}</p>
      </header>

      <div className="grid lg:grid-cols-[248px_minmax(0,1fr)] gap-6 items-start">
        {/* desktop sidebar nav — grouped */}
        <nav
          aria-label="Admin console sections"
          className="hidden lg:block sticky top-28 rounded-card border border-border bg-raised p-3 max-h-[calc(100vh-9rem)] overflow-y-auto ts-scrollbar"
        >
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1 border-b border-border/70">
            <Avatar username={user.username} size={34} />
            <div className="min-w-0">
              <p className="text-label font-bold text-foreground truncate">
                {user.profile?.display_name ?? user.username}
              </p>
              <p className="text-caption text-gold-deep truncate font-bold">{t("admin.roleBadge")}</p>
            </div>
          </div>
          {NAV_GROUPS.map((g) => (
            <div key={g.key} className="mt-2">
              <p className="px-2 pt-1 pb-0.5 text-caption font-bold uppercase tracking-wide text-muted-foreground/80">
                {t(g.labelKey)}
              </p>
              <ul className="space-y-0.5">
                {g.sections.map((key) => (
                  <SidebarItem key={key} sectionKey={key} active={active === key} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-6">
          {/* mobile horizontal scroll pills — grouped */}
          <nav
            aria-label="Admin console sections"
            className="lg:hidden -mx-4 px-4 overflow-x-auto ts-scrollbar"
          >
            <ul className="flex gap-1.5 w-max pb-1 items-center">
              {NAV_GROUPS.map((g) => (
                <li key={g.key} className="flex gap-1.5 items-center">
                  <span
                    className="px-2 py-1 text-caption font-bold uppercase tracking-wide text-muted-foreground/70"
                    aria-hidden="true"
                  >
                    {t(g.labelKey)}
                  </span>
                  {g.sections.map((key) => (
                    <MobilePill key={key} sectionKey={key} active={active === key} />
                  ))}
                </li>
              ))}
            </ul>
          </nav>

          {group.key === "comms" && <CommsContent user={user} section={active as CommsSection} />}
          {group.key === "finance" && <FinanceConsole user={user} section={active as FinanceSection} />}
          {group.key === "trust" && <TrustConsole user={user} section={active as TrustSection} />}
          {group.key === "govern" && <GovernanceConsole user={user} section={active as GovernanceSection} />}
          {group.key === "compliance" && <ComplianceConsole user={user} />}
          {group.key === "platform" && (
            <>
              {active === "users" && <UsersConsole user={user} />}
              {active === "marketplace" && <MarketplaceConsole user={user} />}
              {active === "audit" && <AuditConsole user={user} />}
              {active === "health" && <HealthConsole user={user} />}
              {active === "analytics" && <AnalyticsConsole user={user} />}
              {active === "config" && <ConfigConsole user={user} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  sectionKey,
  active,
}: {
  sectionKey: AdminSection;
  active: boolean;
}) {
  const { t } = useI18n();
  const link = useLinkProps(`/admin/${sectionKey}`);
  const Icon = SECTION_ICON[sectionKey];
  return (
    <li>
      <a
        {...link}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-control px-3 text-label font-semibold transition-colors",
          active
            ? "bg-teal-tint text-teal-deep font-bold"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
        <span className="flex-1 truncate">{t(`admin.nav.${sectionKey}`)}</span>
      </a>
    </li>
  );
}

function MobilePill({
  sectionKey,
  active,
}: {
  sectionKey: AdminSection;
  active: boolean;
}) {
  const { t } = useI18n();
  const link = useLinkProps(`/admin/${sectionKey}`);
  const Icon = SECTION_ICON[sectionKey];
  return (
    <a
      {...link}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-label font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground border-transparent font-bold"
          : "border-border bg-raised text-muted-foreground hover:text-foreground",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
      {t(`admin.nav.${sectionKey}`)}
    </a>
  );
}
