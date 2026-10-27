"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CarFront, FileCheck2, MapPin, ShieldCheck, Wrench } from "lucide-react";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { cn } from "@/lib/utils";
import type { PublicProductBundle, PublicProductFact } from "@/lib/tengasell/types";

const GROUPS = [
  "KEY FACTS", "IDENTITY", "TECHNICAL", "PHYSICAL", "CONDITION", "HISTORY",
  "INSPECTION", "DOCUMENTATION", "KNOWN DEFECTS", "INCLUDED EQUIPMENT",
  "PROVENANCE", "AUCTION", "COLLECTION / TRANSPORT",
] as const;

const SOURCE_TONE: Record<string, string> = {
  "Seller declared": "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "Document verified": "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "Tengasell inspected": "bg-teal/10 text-teal",
  "Externally verified": "bg-ok/10 text-ok",
};

function display(value: unknown, empty = "UNKNOWN") {
  if (value == null || value === "") return empty;
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (value === 1) return "YES";
  if (value === 0) return "NO";
  return String(value).replaceAll("_", " ");
}

function remaining(endsAt: unknown) {
  const time = Date.parse(String(endsAt ?? ""));
  if (!Number.isFinite(time)) return "UNKNOWN";
  const seconds = Math.max(0, Math.floor((time - Date.now()) / 1000));
  if (seconds === 0) return "ENDED";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function FactCard({ label, value, source, conflict, unit }: {
  label: string; value: unknown; source?: string; conflict?: string; unit?: string | null;
}) {
  return (
    <div className="min-w-0 rounded-input border border-border bg-card p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-bodyStrong text-foreground">
        {display(value)}{value != null && unit ? ` ${unit}` : ""}
      </dd>
      {source && (
        <span className={cn("mt-2 inline-flex rounded-pill px-2 py-0.5 text-[10px] font-semibold", SOURCE_TONE[source] ?? "bg-muted text-muted-foreground")}>{source}</span>
      )}
      {conflict === "LOWER_TRUST_DISAGREEMENT" && (
        <p className="mt-2 flex items-start gap-1 text-[11px] font-medium text-warn">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> A lower-trust source reports a different value.
        </p>
      )}
      {conflict === "PEER_CONFLICT" && (
        <p className="mt-2 flex items-start gap-1 text-[11px] font-medium text-danger">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> Conflicting equally trusted evidence; no value selected.
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`pi-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="space-y-3">
      <h3 id={`pi-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="text-label font-bold tracking-wide text-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function VehicleProductIntelligence({ auctionId, compact = false }: { auctionId: number; compact?: boolean }) {
  const resource = useResource<PublicProductBundle>(() => api.publicProductForAuction(auctionId), [auctionId]);
  if (resource.loading) return <div className="min-h-40 animate-pulse rounded-card bg-muted" aria-busy="true" />;
  if (resource.error || !resource.data?.product) {
    return (
      <div role="status" className="rounded-card border border-warn/30 bg-warn/5 p-4 text-caption text-foreground">
        Structured vehicle details are not available yet. Commercial and privacy controls remain in force.
      </div>
    );
  }

  const bundle = resource.data;
  const product = bundle.product as Record<string, any>;
  const facts = new Map(bundle.facts.map((fact) => [fact.key, fact]));
  const fact = (key: string, fallback?: unknown): PublicProductFact => facts.get(key) ?? {
    key, group: "", value: fallback ?? null, source: fallback == null ? "Not provided" : "Seller declared", conflict: "NONE",
  };
  const metric = (key: string, label: string, fallback?: unknown) => {
    const item = fact(key, fallback);
    return <FactCard key={key} label={label} value={item.value} source={item.source} conflict={item.conflict} unit={item.unit} />;
  };
  const odometer = fact("ODOMETER_KM", product.effective_odometer_km);

  const aboveFold = (
    <div className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-caption font-semibold text-teal"><CarFront className="size-4" aria-hidden="true" /> {display(product.product_type)}</p>
          <h2 className="mt-1 text-title text-foreground sm:text-headline">
            {[product.model_year, product.make, product.model, product.trim ?? product.variant].filter(Boolean).join(" ") || "Vehicle details pending"}
          </h2>
          <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground"><MapPin className="size-3.5" aria-hidden="true" /> {display(product.city, "NOT PROVIDED")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-pill border border-border bg-card px-3 py-1 text-caption font-bold">{display(product.auction_status)}</span>
          <span className="rounded-pill bg-teal px-3 py-1 text-caption font-bold text-white">{display(product.inspection_grade, "NOT INSPECTED")}</span>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <FactCard label="Mileage" value={odometer.value == null ? product.effective_odometer_km : odometer.value} unit="km" source={odometer.source === "Not provided" ? display(product.odometer_source) : odometer.source} conflict={String(product.odometer_conflict)} />
        <FactCard label="Fuel" value={product.fuel_type} />
        <FactCard label="Transmission" value={product.transmission} />
        <FactCard label="Drivetrain" value={product.drivetrain} />
        <FactCard label="Body" value={product.body_type} />
        <FactCard label="Steering" value={product.steering_side} />
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FactCard label="Current bid" value={product.current_price == null ? "NOT AVAILABLE" : `US$${Number(product.current_price).toLocaleString()}`} />
        <FactCard label="Time remaining" value={remaining(product.ends_at)} />
        <FactCard label="Reserve" value={product.reserve_disclosure} />
        <FactCard label="Inspection" value={product.inspection_status ?? "NOT INSPECTED"} />
      </dl>
      {Number(product.safety_critical) === 1 && (
        <div role="alert" className="mt-4 flex gap-2 rounded-input border border-danger/30 bg-danger/5 p-3 text-caption font-semibold text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> Material safety-critical inspection finding recorded. Review Known Defects before bidding.
        </div>
      )}
    </div>
  );

  if (compact) return aboveFold;

  const baseGroups: Record<string, [string, string, unknown][]> = {
    "KEY FACTS": [
      ["MODEL_YEAR", "Year", product.model_year], ["MAKE", "Make", product.make], ["MODEL", "Model", product.model],
      ["VARIANT", "Variant / trim", product.trim ?? product.variant], ["ODOMETER_KM", "Effective mileage", product.effective_odometer_km],
    ],
    IDENTITY: [
      ["VIN", "VIN", product.vin_classification], ["CHASSIS_NUMBER", "Chassis", product.chassis_classification],
      ["REGISTRATION_NUMBER", "Registration", product.registration_classification], ["MANUFACTURE_YEAR", "Manufacture year", product.manufacture_year],
    ],
    TECHNICAL: [
      ["FUEL_TYPE", "Fuel", product.fuel_type], ["TRANSMISSION", "Transmission", product.transmission], ["DRIVETRAIN", "Drivetrain", product.drivetrain],
      ["ENGINE_DISPLACEMENT_CC", "Engine displacement", product.engine_displacement_cc], ["POWER_KW", "Power", product.power_kw],
      ["TORQUE_NM", "Torque", product.torque_nm], ["GEAR_COUNT", "Gears", product.gear_count],
      ["EV_BATTERY", "EV battery", product.fuel_type === "ELECTRIC" || product.fuel_type === "HYBRID" ? product.ev_battery_capacity_kwh : "NOT APPLICABLE"],
    ],
    PHYSICAL: [
      ["BODY_TYPE", "Body type", product.body_type], ["STEERING_SIDE", "Steering side", product.steering_side], ["DOORS", "Doors", product.doors],
      ["SEATS", "Seats", product.seats], ["EXTERIOR_COLOUR", "Exterior colour", product.primary_exterior_colour], ["INTERIOR_COLOUR", "Interior colour", product.interior_colour],
    ],
    CONDITION: [
      ["ROADWORTHY", "Roadworthy", product.roadworthy], ["SERVICE_HISTORY_CLASS", "Service history", product.service_history_class],
      ["ACCIDENT_HISTORY", "Accident history", product.accident_history], ["REPAIR_HISTORY", "Repair history", product.repair_history],
      ["STRUCTURAL_REPAIR_HISTORY", "Structural repair", product.structural_repair_history], ["MODIFICATION_STATUS", "Modification status", product.modification_status],
    ],
  };

  return (
    <div className="space-y-7">
      {aboveFold}
      {Object.entries(baseGroups).map(([group, entries]) => (
        <Section key={group} title={group}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map(([key, label, fallback]) => metric(key, label, fallback))}
          </dl>
        </Section>
      ))}

      <Section title="HISTORY">
        {bundle.history.length ? <ul className="space-y-2">{bundle.history.map((row, index) => <li key={index} className="rounded-input border border-border p-3 text-caption"><span className="font-bold">{display(row.event_type)}</span> — {display(row.description, "No additional details")}</li>)}</ul> : <p className="text-caption text-muted-foreground">NOT PROVIDED — no structured history event has been asserted.</p>}
      </Section>
      <Section title="INSPECTION">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FactCard label="Status" value={product.inspection_status ?? "NOT INSPECTED"} source={product.inspection_status ? "Tengasell inspected" : undefined} />
          <FactCard label="Grade" value={product.inspection_grade ?? "NOT INSPECTED"} source={product.inspection_grade ? "Tengasell inspected" : undefined} />
          <FactCard label="Inspection mileage" value={product.inspection_odometer_km} unit="km" source={product.inspection_odometer_km == null ? undefined : "Tengasell inspected"} />
          <FactCard label="Major defects" value={product.major_defect_count ?? 0} />
          <FactCard label="Structural summary" value={product.structural_condition_summary} />
          <FactCard label="Mechanical summary" value={product.mechanical_condition_summary} />
        </dl>
      </Section>
      <Section title="DOCUMENTATION">
        {bundle.documents.length ? <ul className="grid gap-2 sm:grid-cols-2">{bundle.documents.map((row, index) => <li key={index} className="flex items-center justify-between gap-3 rounded-input border border-border p-3 text-caption"><span className="flex items-center gap-2 font-semibold"><FileCheck2 className="size-4 text-teal" />{display(row.document_type)}</span><span>{display(row.evidence_classification)}</span></li>)}</ul> : <p className="text-caption text-muted-foreground">NOT PROVIDED — no buyer-visible document classification is available.</p>}
      </Section>
      <Section title="KNOWN DEFECTS">
        {bundle.findings.length ? <ul className="space-y-2">{bundle.findings.map((row, index) => <li key={index} className={cn("rounded-input border p-3 text-caption", row.safety_critical ? "border-danger/40 bg-danger/5" : "border-border")}><span className="font-bold">{display(row.severity)} · {display(row.component)}</span><p className="mt-1 text-muted-foreground">{display(row.description, "NOT PROVIDED")}</p></li>)}</ul> : <p className="text-caption text-muted-foreground">NOT PROVIDED — absence of a recorded defect is not proof that no defect exists.</p>}
      </Section>
      <Section title="INCLUDED EQUIPMENT">
        {bundle.equipment.length ? <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{bundle.equipment.map((row, index) => <li key={index} className="flex items-center gap-2 rounded-input border border-border p-3 text-caption"><Wrench className="size-4 text-teal" /><span><strong>{display(row.equipment_type)}</strong> — {display(row.name)}</span></li>)}</ul> : <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><FactCard label="Keys" value={product.number_of_keys} /><FactCard label="Spare wheel" value={product.spare_wheel} /><FactCard label="Tool kit" value={product.tool_kit} /><FactCard label="Manuals" value={product.manuals} /><FactCard label="Service book" value={product.service_book} /></dl>}
      </Section>
      <Section title="PROVENANCE">
        <div className="rounded-input border border-border bg-muted/40 p-4"><p className="flex items-center gap-2 text-caption font-semibold"><ShieldCheck className="size-4 text-teal" /> Product values retain their source. Inspection and verified evidence do not erase seller assertions.</p><div className="mt-3 flex flex-wrap gap-2">{[...new Set(bundle.facts.map((item) => item.source))].map((source) => <span key={source} className={cn("rounded-pill px-2 py-1 text-[11px] font-semibold", SOURCE_TONE[source] ?? "bg-card")}>{source}</span>)}</div></div>
      </Section>
      <Section title="AUCTION">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><FactCard label="Status" value={product.auction_status} /><FactCard label="Current bid" value={product.current_price == null ? "NOT AVAILABLE" : `US$${Number(product.current_price).toLocaleString()}`} /><FactCard label="Reserve disclosure" value={product.reserve_disclosure} /><FactCard label="Time remaining" value={remaining(product.ends_at)} /></dl>
      </Section>
      <Section title="COLLECTION / TRANSPORT">
        <div className="rounded-input border border-border p-4 text-caption"><p className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-teal" /> Collection location: {display(product.city, "NOT PROVIDED")}</p><p className="mt-2 text-muted-foreground">Transport booking and release remain controlled post-sale workflows. Availability is confirmed on the Won Lot experience.</p></div>
      </Section>
      <span className="sr-only">{GROUPS.join(", ")}</span>
    </div>
  );
}
