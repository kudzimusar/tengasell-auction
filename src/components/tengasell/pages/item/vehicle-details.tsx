"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileCheck2, Gauge, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useResource } from "@/lib/tengasell/hooks";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { VehicleBundle, VehicleFinding } from "@/lib/tengasell/types";

const FINDING_CATEGORIES = ["BODY","STRUCTURAL","MECHANICAL","INTERIOR","TYRES","ELECTRICAL","GLASS","UNDERBODY"] as const;
const SEVERITIES = ["MINOR","MODERATE","MAJOR","CRITICAL"] as const;

function StatusBadge({ value }: { value: string }) {
  const positive = value === "ELIGIBLE" || value === "VERIFIED" || value === "REVIEWED";
  const negative = value === "INELIGIBLE" || value === "REJECTED" || value === "EXPIRED";
  return (
    <span className={cn(
      "inline-flex min-h-6 items-center rounded-pill border px-2 py-0.5 text-[11px] font-bold tracking-wide",
      positive && "border-ok/40 bg-ok/10 text-ok",
      negative && "border-danger/40 bg-danger/10 text-danger",
      !positive && !negative && "border-border bg-muted text-muted-foreground",
    )}>{value.replaceAll("_"," ")}</span>
  );
}

function Spec({ label, value, provenance }: { label: string; value: unknown; provenance?: string }) {
  return (
    <div className="rounded-input border border-border bg-card p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-bodyStrong text-foreground break-words">{value == null || value === "" ? "—" : String(value)}</dd>
      {provenance && (
        <span className="mt-1 inline-flex text-[10px] font-semibold uppercase tracking-wide text-teal">
          {provenance.replaceAll("_"," ")}
        </span>
      )}
    </div>
  );
}

export function VehicleDetails({ auctionId }: { auctionId: number }) {
  const { user } = useAuth();
  const res = useResource<VehicleBundle>(
    () => api.vehicleForAuction(auctionId),
    [auctionId, user?.username],
  );
  const bundle = res.data;
  const vehicle = bundle?.vehicle;
  const inspection = bundle?.inspection;
  const permissions = bundle?.permissions ?? { inspect: false, review: false, administer: false };
  const [busy, setBusy] = useState<string | null>(null);

  const [findingCategory, setFindingCategory] = useState<(typeof FINDING_CATEGORIES)[number]>("BODY");
  const [findingSeverity, setFindingSeverity] = useState<(typeof SEVERITIES)[number]>("MINOR");
  const [findingComponent, setFindingComponent] = useState("");
  const [findingLocation, setFindingLocation] = useState("");
  const [findingDescription, setFindingDescription] = useState("");
  const [findingSafety, setFindingSafety] = useState(false);
  const [findingRepair, setFindingRepair] = useState(false);
  const [roadworthy, setRoadworthy] = useState(true);
  const [inspectionOdometer, setInspectionOdometer] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");

  const latestFindings = bundle?.findings ?? [];
  const critical = latestFindings.filter((f) => f.severity === "CRITICAL" || f.safety_critical === 1);
  const canStart = permissions.inspect && (!inspection || ["REVIEWED","REJECTED","SUPERSEDED"].includes(inspection.lifecycle));

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await res.reload();
      toast({ title: success });
    } catch (err) {
      toast({
        title: "Vehicle action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const provenance = bundle?.provenance ?? {};
  const reasons = bundle?.eligibilityReasons ?? [];

  if (res.loading) {
    return <div className="min-h-40 animate-pulse rounded-card bg-muted" aria-busy="true" />;
  }
  if (res.error) {
    return (
      <div role="alert" className="rounded-card border border-danger/30 bg-danger/5 p-4 text-caption text-danger">
        Vehicle authority could not be loaded. {res.error}
      </div>
    );
  }
  if (!vehicle) {
    return (
      <div className="rounded-card border border-warn/40 bg-warn/5 p-4">
        <p className="flex items-center gap-2 text-bodyStrong text-foreground">
          <AlertTriangle className="size-4 text-warn" aria-hidden="true" />
          Vehicle intake pending
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          This listing is declared as a whole vehicle, but its structured intake record is not available. Commercial bidding remains blocked.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="vehicle-authority-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="vehicle-authority-heading" className="text-title text-foreground">Vehicle authority</h3>
            <p className="text-caption text-muted-foreground">
              Seller declarations are shown separately from Tengasell-verified inspection evidence.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {vehicle.tengasell_grade && (
              <span aria-label={`Tengasell grade ${vehicle.tengasell_grade}`} className="grid size-10 place-items-center rounded-full bg-teal text-base font-black text-white">
                {vehicle.tengasell_grade}
              </span>
            )}
            <StatusBadge value={bundle?.eligibility?.status ?? vehicle.lifecycle} />
          </div>
        </div>

        {reasons.length > 0 && (
          <div role="status" className="rounded-input border border-danger/30 bg-danger/5 p-3">
            <p className="text-label font-bold text-danger">Auction eligibility reasons</p>
            <ul className="mt-2 space-y-1 text-caption text-foreground">
              {reasons.map((r) => <li key={r.id}>• <span className="font-semibold">{r.code.replaceAll("_"," ")}</span> — {r.detail}</li>)}
            </ul>
          </div>
        )}

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Spec label="VIN" value={vehicle.vin} provenance={provenance.vin} />
          <Spec label="Chassis" value={vehicle.chassis_number} provenance={provenance.chassis_number} />
          <Spec label="Registration" value={vehicle.registration_number} provenance={provenance.registration_number} />
          <Spec label="Make" value={vehicle.make} provenance={provenance.make} />
          <Spec label="Model" value={vehicle.model} provenance={provenance.model} />
          <Spec label="Variant" value={vehicle.variant} provenance={provenance.variant} />
          <Spec label="Model year" value={vehicle.model_year} provenance={provenance.model_year} />
          <Spec label="Fuel" value={vehicle.fuel_type} provenance={provenance.fuel_type} />
          <Spec label="Transmission" value={vehicle.transmission} provenance={provenance.transmission} />
          <Spec label="Drivetrain" value={vehicle.drivetrain} provenance={provenance.drivetrain} />
          <Spec label="Engine" value={vehicle.engine_number} provenance={provenance.engine_number} />
          <Spec label="Engine cc" value={vehicle.engine_displacement_cc} provenance={provenance.engine_displacement_cc} />
          <Spec label="Odometer" value={`${Number(vehicle.odometer_km).toLocaleString()} km`} provenance={provenance.odometer_km} />
          <Spec label="Location" value={`${vehicle.location_city}, ${vehicle.location_country}`} provenance={provenance.location_city} />
          <Spec label="Ownership" value={vehicle.ownership_status} provenance={provenance.ownership_status} />
          <Spec label="Customs" value={vehicle.customs_status} provenance={provenance.customs_status} />
        </dl>
      </section>

      <section aria-labelledby="vehicle-docs-heading" className="space-y-3">
        <h3 id="vehicle-docs-heading" className="flex items-center gap-2 text-bodyStrong text-foreground">
          <FileCheck2 className="size-4 text-teal" aria-hidden="true" /> Vehicle documents
        </h3>
        {(bundle?.documents?.length ?? 0) === 0 ? (
          <p className="text-caption text-muted-foreground">No document declarations have been recorded.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {bundle!.documents!.map((doc) => (
              <li key={doc.id} className="rounded-input border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-label font-semibold text-foreground">{doc.document_type.replaceAll("_"," ")}</p>
                    <p className="text-caption text-muted-foreground">Ref {doc.document_ref}</p>
                  </div>
                  <StatusBadge value={doc.status} />
                </div>
                {(permissions.inspect || permissions.review) && ["DECLARED","UPLOADED","REJECTED"].includes(doc.status) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" className="min-h-9" disabled={busy === `doc-${doc.id}`}
                      onClick={() => void run(`doc-${doc.id}`, () => api.reviewVehicleDocument(doc.id,"VERIFY"), "Document verified")}>
                      <CheckCircle2 className="size-4" aria-hidden="true" /> Verify
                    </Button>
                    <Button size="sm" variant="outline" className="min-h-9" disabled={busy === `doc-${doc.id}`}
                      onClick={() => void run(`doc-${doc.id}`, () => api.reviewVehicleDocument(doc.id,"REJECT","Evidence did not satisfy verification requirements."), "Document rejected")}>
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inspection-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="inspection-heading" className="flex items-center gap-2 text-bodyStrong text-foreground">
              <ClipboardCheck className="size-4 text-teal" aria-hidden="true" /> Tengasell Inspection
            </h3>
            <p className="text-caption text-muted-foreground">
              Versioned inspection, structured damage findings and reviewer-owned grading.
            </p>
          </div>
          {canStart && (
            <Button variant="outline" className="min-h-11" disabled={busy === "start"}
              onClick={() => void run("start", () => api.startVehicleInspection(vehicle.id), "Inspection started")}>
              {busy === "start" ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
              Start inspection
            </Button>
          )}
        </div>

        {inspection ? (
          <div className="rounded-card border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-label font-bold">Inspection v{inspection.version}</p>
              <StatusBadge value={inspection.lifecycle} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Spec label="Inspector" value={inspection.inspector_name} />
              <Spec label="Roadworthy" value={inspection.roadworthy ? "Yes" : "No"} />
              <Spec label="Inspection odometer" value={`${Number(inspection.odometer_km).toLocaleString()} km`} />
              <Spec label="Score" value={inspection.grade_score == null ? "Pending review" : `${inspection.grade_score}/100`} />
              <Spec label="Grade" value={inspection.grade ?? "Pending review"} />
              <Spec label="Reviewer" value={inspection.reviewer_name ?? "Pending"} />
            </div>
            {inspection.notes && <p className="mt-3 whitespace-pre-wrap text-caption text-muted-foreground">{inspection.notes}</p>}
          </div>
        ) : (
          <p className="rounded-input border border-dashed border-border p-4 text-caption text-muted-foreground">No inspection has started.</p>
        )}

        {latestFindings.length > 0 && (
          <div className="space-y-2">
            <p className="text-label font-semibold text-foreground">Damage & condition findings</p>
            <ul className="space-y-2">
              {latestFindings.map((f: VehicleFinding) => (
                <li key={f.id} className={cn("rounded-input border p-3", (f.severity === "CRITICAL" || f.safety_critical) ? "border-danger/40 bg-danger/5" : "border-border bg-section")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={f.severity} />
                    <span className="text-label font-semibold">{f.category} · {f.component}</span>
                    {f.safety_critical === 1 && <span className="text-caption font-bold text-danger">Safety critical</span>}
                  </div>
                  <p className="mt-1 text-caption text-foreground">{f.description}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {inspection?.lifecycle === "DRAFT" && permissions.inspect && (
          <div className="space-y-4 rounded-card border border-teal/30 bg-teal-tint/10 p-4">
            <h4 className="text-label font-bold text-foreground">Inspector controls</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={findingCategory} onValueChange={(v) => setFindingCategory(v as typeof findingCategory)}>
                <SelectTrigger className="min-h-11" aria-label="Finding category"><SelectValue /></SelectTrigger>
                <SelectContent>{FINDING_CATEGORIES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={findingSeverity} onValueChange={(v) => setFindingSeverity(v as typeof findingSeverity)}>
                <SelectTrigger className="min-h-11" aria-label="Finding severity"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="min-h-11" aria-label="Component" placeholder="Component, e.g. left fender" value={findingComponent} onChange={(e) => setFindingComponent(e.target.value)} />
              <Input className="min-h-11" aria-label="Finding location" placeholder="Location (optional)" value={findingLocation} onChange={(e) => setFindingLocation(e.target.value)} />
            </div>
            <Textarea aria-label="Finding description" placeholder="Describe the finding" value={findingDescription} onChange={(e) => setFindingDescription(e.target.value)} />
            <div className="flex flex-wrap gap-5">
              <Label className="flex min-h-11 items-center gap-2"><Checkbox checked={findingRepair} onCheckedChange={(v) => setFindingRepair(v === true)} /> Repair recommended</Label>
              <Label className="flex min-h-11 items-center gap-2"><Checkbox checked={findingSafety} onCheckedChange={(v) => setFindingSafety(v === true)} /> Safety critical</Label>
            </div>
            <Button variant="outline" className="min-h-11" disabled={busy === "finding" || findingComponent.trim().length < 2 || findingDescription.trim().length < 5}
              onClick={() => void run("finding", async () => {
                await api.addVehicleFinding(inspection.id, {
                  category: findingCategory, component: findingComponent, location: findingLocation || null,
                  severity: findingSeverity, description: findingDescription,
                  repairRecommended: findingRepair, safetyCritical: findingSafety,
                });
                setFindingComponent(""); setFindingLocation(""); setFindingDescription(""); setFindingSafety(false); setFindingRepair(false);
              }, "Finding recorded")}>
              Add finding
            </Button>

            <div className="border-t border-border pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input className="min-h-11" type="number" min={0} inputMode="numeric" aria-label="Inspection odometer kilometres"
                  placeholder={String(vehicle.odometer_km)} value={inspectionOdometer} onChange={(e) => setInspectionOdometer(e.target.value)} />
                <Label className="flex min-h-11 items-center gap-2"><Checkbox checked={roadworthy} onCheckedChange={(v) => setRoadworthy(v === true)} /> Roadworthy</Label>
              </div>
              <Textarea className="mt-3" aria-label="Inspection notes" placeholder="Inspection notes" value={inspectionNotes} onChange={(e) => setInspectionNotes(e.target.value)} />
              <Button className="mt-3 min-h-11" disabled={busy === "submit"}
                onClick={() => void run("submit", () => api.submitVehicleInspection(inspection.id, {
                  roadworthy,
                  odometerKm: Number(inspectionOdometer || vehicle.odometer_km),
                  notes: inspectionNotes,
                }), "Inspection submitted for review")}>
                <ClipboardCheck className="size-4" /> Submit inspection
              </Button>
            </div>
          </div>
        )}

        {inspection?.lifecycle === "SUBMITTED" && permissions.review && (
          <div className="rounded-card border border-gold/40 bg-gold-soft/30 p-4">
            <p className="text-label font-bold text-foreground">Reviewer decision</p>
            <p className="mt-1 text-caption text-muted-foreground">
              Review uses Tengasell grading rules, verified document evidence and safety findings. The result is persisted with eligibility reason codes.
            </p>
            {critical.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-caption font-semibold text-danger">
                <AlertTriangle className="size-4" /> {critical.length} critical/safety-critical finding(s) will fail eligibility.
              </p>
            )}
            <Button className="mt-3 min-h-11" disabled={busy === "review"}
              onClick={() => void run("review", () => api.reviewVehicleInspection(inspection.id), "Vehicle review completed")}>
              {busy === "review" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Apply Tengasell grade & eligibility
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
