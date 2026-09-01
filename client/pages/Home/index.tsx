import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useSuperblocksDataTags } from "@superblocksteam/library";

import { useApi } from "@/hooks/useApi.js";
import { executeApi } from "@/lib/executeApi.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

import AppHeader from "@/components/common/AppHeader";
import EscalationInputs from "@/components/escalation/EscalationInputs";
import RecommendationCard from "@/components/escalation/RecommendationCard";
import { useEmbed } from "@/context/EmbedContext";

interface Recommendation {
  escalationPoint: string;
  recommendedTeam: string;
  currentStatus: string;
  rfiStatus: "Open" | "Closed" | "None";
  whatIsOutstanding: string;
  customerMessage: string;
  suggestedInternalAction: string;
  supportingInfo: {
    accountId: string;
    userId: string | null;
    email: string | null;
    cardholderId: string | null;
    cardId: string | null;
    transactionId: string | null;
    depositId: string | null;
    payoutId: string | null;
    kycStage: string | null;
    watchlistSource: string | null;
    owningEntity: string | null;
    region: string | null;
    legalEntityId: string | null;
    universalCaseSummary: string | null;
    kybCaseStatus: string | null;
    nsCasesSummary: string | null;
    realtimeTmSummary: string | null;
  };
  missingInputs: string[];
  conflicts: string[];
}

/** Preferred region order when scanning. */
const REGION_PRIORITY = ["sg", "hk", "us", "nl"];

/** Tags to exclude from scanning (dev/demo environments). */
const EXCLUDED_PREFIXES = ["dev", "demo", "localhost"];

/**
 * Build scan order from all available data tags.
 * Excludes dev/demo tags, then sorts by region priority.
 */
function buildScanOrder(availableKeys: string[]): string[] {
  const candidates = availableKeys.filter(
    (key) => !EXCLUDED_PREFIXES.some((p) => key.startsWith(p)),
  );
  // Sort by region priority — known regions first, then the rest
  return candidates.sort((a, b) => {
    const aIdx = REGION_PRIORITY.findIndex((r) => a.endsWith(`_${r}`));
    const bIdx = REGION_PRIORITY.findIndex((r) => b.endsWith(`_${r}`));
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
}

const INITIAL_INPUTS = {
  accountId: "",
  cle: "",
};

export default function HomePage() {
  const [inputs, setInputs] = useState(INITIAL_INPUTS);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [resolvedTag, setResolvedTag] = useState<string | null>(null);

  const { dataTags, setDataTag } = useSuperblocksDataTags();
  const { airboardToken } = useEmbed();
  const { run: analyseEscalation } = useApi("AnalyseEscalation");
  const cancelledRef = useRef(false);

  const handleInputChange = useCallback((field: string, value: string) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleAnalyse = useCallback(async () => {
    setError(null);
    setRecommendation(null);
    setCopied(false);
    setResolvedTag(null);
    setScanStatus(null);
    cancelledRef.current = false;

    if (!inputs.accountId.trim()) {
      setError("Account ID is required.");
      return;
    }

    setLoading(true);

    const accountId = inputs.accountId.trim();

    const availableKeys = dataTags?.available.map((t) => t.key) ?? [];
    const tagsToScan = buildScanOrder(availableKeys);

    if (tagsToScan.length === 0) {
      setError("No data tags available for scanning.");
      setLoading(false);
      return;
    }

    // Phase 1: Scan data tags to resolve the account
    let foundInTag: string | null = null;
    let resolveInfo: {
      owningEntity: string | null;
      dataCenter: string | null;
      businessName: string | null;
    } | null = null;

    for (const tagKey of tagsToScan) {
      if (cancelledRef.current) break;

      const tagDisplay =
        dataTags?.available.find((t) => t.key === tagKey)?.displayName ??
        tagKey;
      setScanStatus(`Checking ${tagDisplay}…`);

      setDataTag(tagKey);
      await new Promise((r) => setTimeout(r, 150));

      try {
        const result = await executeApi("ResolveAccount", {
          accountId,
          airboardToken,
        });
        if (result?.found) {
          foundInTag = tagKey;
          resolveInfo = {
            owningEntity: result.owningEntity,
            dataCenter: result.dataCenter,
            businessName: result.businessName,
          };
          break;
        }
      } catch {
        // continue to next tag
      }
    }

    if (cancelledRef.current) {
      setLoading(false);
      setScanStatus(null);
      return;
    }

    if (!foundInTag) {
      setError(
        `Account ID "${accountId}" was not found in any region (${tagsToScan
          .map(
            (k) =>
              dataTags?.available.find((t) => t.key === k)?.displayName ?? k,
          )
          .join(", ")}). Verify the Account ID is correct.`,
      );
      setLoading(false);
      setScanStatus(null);
      return;
    }

    // Phase 2: Account found — run full analysis
    const resolvedDisplay =
      dataTags?.available.find((t) => t.key === foundInTag)?.displayName ??
      foundInTag;
    setResolvedTag(resolvedDisplay);
    setScanStatus(`Account found in ${resolvedDisplay}. Analysing…`);

    setDataTag(foundInTag);
    await new Promise((r) => setTimeout(r, 150));

    try {
      const result = await analyseEscalation({
        accountId,
        airboardToken,
        ticketContext: null,
        userId: null,
        email: null,
        cardholderId: null,
        cardId: null,
        transactionId: null,
        depositId: null,
        payoutId: null,
        cle: inputs.cle.trim() || null,
      });

      if (result?.error) {
        if (result.error.includes("was not found")) {
          setError(
            `Account resolved in ${resolvedDisplay} but sources returned no data. This may indicate a permissions issue.`,
          );
        } else {
          setError(result.error);
        }
      } else if (result?.recommendation) {
        const rec = result.recommendation as Recommendation;
        if (resolveInfo?.owningEntity && !rec.supportingInfo.owningEntity) {
          rec.supportingInfo.owningEntity = resolveInfo.owningEntity;
        }
        if (resolveInfo?.dataCenter && !rec.supportingInfo.region) {
          rec.supportingInfo.region = resolveInfo.dataCenter;
        }
        setRecommendation(rec);
      } else {
        setError("No recommendation returned. Please try again.");
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(`Analysis failed: ${message}`);
    } finally {
      setLoading(false);
      setScanStatus(null);
    }
  }, [inputs, analyseEscalation, dataTags, setDataTag, airboardToken]);

  const handleCopy = useCallback(() => {
    if (!recommendation) return;

    const {
      escalationPoint,
      recommendedTeam,
      currentStatus,
      rfiStatus,
      whatIsOutstanding,
      suggestedInternalAction,
      supportingInfo,
      missingInputs,
    } = recommendation;

    const lines = [
      `Escalation point: ${escalationPoint}`,
      `Recommended team: ${recommendedTeam}`,
      `Current status: ${currentStatus}`,
      `RFI: ${rfiStatus}`,
      `What is outstanding: ${whatIsOutstanding}`,
      `Suggested internal action: ${suggestedInternalAction}`,
      "",
      "--- Identifiers ---",
      `Account ID: ${supportingInfo.accountId}`,
    ];

    if (supportingInfo.userId) lines.push(`User ID: ${supportingInfo.userId}`);
    if (supportingInfo.email) lines.push(`Email: ${supportingInfo.email}`);
    if (supportingInfo.cardholderId)
      lines.push(`Cardholder ID: ${supportingInfo.cardholderId}`);
    if (supportingInfo.cardId) lines.push(`Card ID: ${supportingInfo.cardId}`);
    if (supportingInfo.transactionId)
      lines.push(`Transaction ID: ${supportingInfo.transactionId}`);
    if (supportingInfo.depositId)
      lines.push(`Deposit ID: ${supportingInfo.depositId}`);
    if (supportingInfo.payoutId)
      lines.push(`Payout ID: ${supportingInfo.payoutId}`);
    if (supportingInfo.owningEntity)
      lines.push(`Owning entity: ${supportingInfo.owningEntity}`);
    if (supportingInfo.region) lines.push(`Region: ${supportingInfo.region}`);

    if (missingInputs.length > 0) {
      lines.push("");
      lines.push("--- Missing inputs ---");
      missingInputs.forEach((m) => lines.push(`• ${m}`));
    }

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      toast.success("Escalation summary copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }, [recommendation]);

  const handleClear = useCallback(() => {
    setInputs(INITIAL_INPUTS);
    setRecommendation(null);
    setError(null);
    setCopied(false);
    setResolvedTag(null);
    setScanStatus(null);
    cancelledRef.current = true;
  }, []);

  return (
    <div className="flex flex-col min-h-svh bg-[#fafafa]">
      {/* Airboard-style header */}
      <AppHeader />

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* Page intro */}
          <p className="text-[13px] text-[#6b7280] mb-5">
            Enter an Account ID to identify the escalation point and recommended
            team. All available regions are scanned automatically.
          </p>

          {/* Input card */}
          <div className="rounded-lg border border-[#e2e5ea] bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4">
              <EscalationInputs
                accountId={inputs.accountId}
                cle={inputs.cle}
                onChange={handleInputChange}
              />
            </div>

            {/* Actions bar */}
            <div className="flex items-center gap-3 px-5 py-3 border-t border-[#e2e5ea] bg-[#fafafa]">
              <Button
                onClick={handleAnalyse}
                disabled={loading}
                className="bg-[#FF6B00] hover:bg-[#e55f00] text-white text-sm h-9 px-4"
              >
                {loading ? (
                  <>
                    <Icon
                      icon="loader-2"
                      className="h-3.5 w-3.5 animate-spin"
                    />
                    Scanning…
                  </>
                ) : (
                  <>
                    <Icon icon="search" className="h-3.5 w-3.5" />
                    Analyse Escalation
                  </>
                )}
              </Button>

              {recommendation && (
                <Button
                  variant="outline"
                  onClick={handleCopy}
                  className="text-sm h-9 border-[#d1d5db]"
                >
                  <Icon
                    icon={copied ? "check" : "copy"}
                    className="h-3.5 w-3.5"
                  />
                  {copied ? "Copied" : "Copy Summary"}
                </Button>
              )}

              <Button
                variant="ghost"
                onClick={handleClear}
                className="text-sm h-9 text-[#6b7280] hover:text-[#374151]"
              >
                <Icon icon="x" className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>

          {/* Scan progress */}
          {loading && scanStatus && (
            <div className="mt-4 flex items-center gap-2 px-4 py-2.5 border border-[#bfdbfe] bg-[#eff6ff] rounded-lg">
              <Icon
                icon="loader-2"
                className="h-3.5 w-3.5 animate-spin text-[#2563eb]"
              />
              <p className="text-[13px] text-[#1e40af]">{scanStatus}</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="mt-4 flex items-start gap-2 px-4 py-3 border border-[#fecaca] bg-[#fef2f2] rounded-lg">
              <Icon
                icon="alert-circle"
                className="h-4 w-4 text-[#dc2626] mt-0.5 shrink-0"
              />
              <p className="text-[13px] text-[#991b1b]">{error}</p>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !scanStatus && (
            <div className="mt-4 rounded-lg border border-[#e2e5ea] bg-white p-5 space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {/* Recommendation result */}
          {recommendation && !loading && (
            <div className="mt-4">
              {resolvedTag && (
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] border border-[#a7f3d0] px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                  <span className="text-xs font-medium text-[#065f46]">
                    Resolved in {resolvedTag}
                  </span>
                </div>
              )}
              <RecommendationCard recommendation={recommendation} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
