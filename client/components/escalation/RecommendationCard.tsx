import { useCallback, useState } from "react";
import { Icon } from "@/components/ui/icon";

interface SupportingInfo {
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
  globalWatchlistStatus: string | null;
  globalWatchlistCategory: string | null;
  globalWatchlistReason: string | null;
}

interface Recommendation {
  escalationPoint: string;
  recommendedTeam: string;
  currentStatus: string;
  rfiStatus: "Open" | "Closed" | "None";
  whatIsOutstanding: string;
  customerMessage: string;
  suggestedInternalAction: string;
  supportingInfo: SupportingInfo;
  missingInputs: string[];
  conflicts: string[];
}

interface RecommendationCardProps {
  recommendation: Recommendation;
}

const TEAM_STYLES: Record<string, string> = {
  KYC: "bg-[#dbeafe] text-[#1e40af] border-[#93c5fd]",
  KYB: "bg-[#e0f2fe] text-[#0369a1] border-[#7dd3fc]",
  TM: "bg-[#ede9fe] text-[#5b21b6] border-[#c4b5fd]",
  PA: "bg-[#fff1e6] text-[#c2410c] border-[#fdba74]",
};

function getTeamStyle(team: string) {
  for (const [prefix, style] of Object.entries(TEAM_STYLES)) {
    if (team.startsWith(prefix)) return style;
  }
  return "bg-[#f3f4f6] text-[#374151] border-[#d1d5db]";
}

const RFI_STYLES: Record<string, string> = {
  Open: "text-[#92400e] bg-[#fef3c7] border-[#fcd34d]",
  Closed: "text-[#065f46] bg-[#d1fae5] border-[#6ee7b7]",
  None: "text-[#6b7280] bg-[#f3f4f6] border-[#d1d5db]",
};

export default function RecommendationCard({
  recommendation,
}: RecommendationCardProps) {
  const [showSupporting, setShowSupporting] = useState(false);

  const {
    escalationPoint,
    recommendedTeam,
    currentStatus,
    rfiStatus,
    whatIsOutstanding,
    customerMessage,
    suggestedInternalAction,
    supportingInfo,
    missingInputs,
    conflicts,
  } = recommendation;

  const toggleSupporting = useCallback(() => {
    setShowSupporting((prev) => !prev);
  }, []);

  return (
    <div className="rounded-lg border border-[#e2e5ea] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#e2e5ea] bg-[#111111]">
        <h2 className="text-sm font-semibold text-white">
          Escalation Recommendation
        </h2>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* Escalation point */}
        <Field label="Escalation Point">
          <p className="text-[13px] text-[#111827]">{escalationPoint}</p>
        </Field>

        {/* Recommended team */}
        <Field label="Recommended Team">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded text-[13px] font-semibold border ${getTeamStyle(recommendedTeam)}`}
          >
            {recommendedTeam}
          </span>
        </Field>

        {/* Current status */}
        <Field label="Current Status">
          <p className="text-[13px] text-[#111827]">{currentStatus}</p>
        </Field>

        {/* RFI */}
        <Field label="RFI">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${RFI_STYLES[rfiStatus]}`}
          >
            {rfiStatus}
          </span>
        </Field>

        {/* What is outstanding */}
        <div className="rounded-md bg-[#f9fafb] border border-[#e5e7eb] p-3">
          <FieldLabel>What is Outstanding</FieldLabel>
          <p className="mt-1 text-[13px] font-medium text-[#111827]">
            {whatIsOutstanding}
          </p>
        </div>

        {/* Customer message */}
        <div className="rounded-md bg-[#fff7ed] border border-[#fed7aa] p-3">
          <FieldLabel className="text-[#c2410c]">
            What CS Should Tell the Customer
          </FieldLabel>
          <p className="mt-1 text-[13px] text-[#431407] leading-relaxed">
            {customerMessage}
          </p>
        </div>

        {/* Suggested internal action */}
        <Field label="Suggested Internal Action">
          <p className="text-[13px] text-[#111827]">
            {suggestedInternalAction}
          </p>
        </Field>

        {/* Missing inputs */}
        {missingInputs.length > 0 && (
          <div className="rounded-md bg-[#fffbeb] border border-[#fcd34d] p-3">
            <FieldLabel className="text-[#92400e]">Missing Inputs</FieldLabel>
            <ul className="mt-1 space-y-0.5">
              {missingInputs.map((m, i) => (
                <li key={i} className="text-[13px] text-[#78350f]">
                  • {m}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="rounded-md bg-[#fef2f2] border border-[#fca5a5] p-3">
            <FieldLabel className="text-[#991b1b]">Conflicts</FieldLabel>
            <ul className="mt-1 space-y-0.5">
              {conflicts.map((c, i) => (
                <li key={i} className="text-[13px] text-[#7f1d1d]">
                  • {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Supporting info (collapsible) */}
      <div className="border-t border-[#e2e5ea]">
        <button
          onClick={toggleSupporting}
          className="flex items-center justify-between w-full px-5 py-2.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#fafbfc] transition-colors"
        >
          <span>Supporting Information</span>
          <Icon
            icon={showSupporting ? "chevron-up" : "chevron-down"}
            className="h-4 w-4"
          />
        </button>

        {showSupporting && (
          <div className="px-5 pb-4 grid grid-cols-2 gap-x-6 gap-y-2">
            <InfoRow label="Account ID" value={supportingInfo.accountId} />
            <InfoRow label="User ID" value={supportingInfo.userId} />
            <InfoRow label="Email" value={supportingInfo.email} />
            <InfoRow
              label="Cardholder ID"
              value={supportingInfo.cardholderId}
            />
            <InfoRow label="Card ID" value={supportingInfo.cardId} />
            <InfoRow
              label="Transaction ID"
              value={supportingInfo.transactionId}
            />
            <InfoRow label="Deposit ID" value={supportingInfo.depositId} />
            <InfoRow label="Payout ID" value={supportingInfo.payoutId} />
            <InfoRow label="KYC Stage" value={supportingInfo.kycStage} />
            <InfoRow
              label="Watchlist Source"
              value={supportingInfo.watchlistSource}
            />
            <InfoRow
              label="Owning Entity"
              value={supportingInfo.owningEntity}
            />
            <InfoRow label="Region" value={supportingInfo.region} />
            <InfoRow
              label="Legal Entity ID"
              value={supportingInfo.legalEntityId}
            />
            <InfoRow
              label="Universal Cases"
              value={supportingInfo.universalCaseSummary}
            />
            <InfoRow
              label="KYB Status"
              value={supportingInfo.kybCaseStatus}
            />
            <InfoRow
              label="NS/Watchlist Cases"
              value={supportingInfo.nsCasesSummary}
            />
            <InfoRow
              label="Realtime TM"
              value={supportingInfo.realtimeTmSummary}
            />
            {supportingInfo.globalWatchlistStatus && (
              <>
                <InfoRow
                  label="Global Watchlist"
                  value={`${supportingInfo.globalWatchlistStatus} — ${supportingInfo.globalWatchlistCategory ?? "Unknown"}`}
                />
                <InfoRow
                  label="Watchlist Reason"
                  value={supportingInfo.globalWatchlistReason}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Tiny helper sub-components ---------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function FieldLabel({
  children,
  className = "text-[#9ca3af]",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wider ${className}`}
    >
      {children}
    </span>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-[#9ca3af]">{label}</span>
      <span className="text-[13px] text-[#111827] truncate font-mono">
        {value ?? (
          <span className="italic text-[#d1d5db] font-sans">—</span>
        )}
      </span>
    </div>
  );
}
