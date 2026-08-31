import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EscalationInputsProps {
  accountId: string;
  userId: string;
  email: string;
  cardholderId: string;
  cardId: string;
  transactionId: string;
  depositId: string;
  payoutId: string;
  onChange: (field: string, value: string) => void;
}

export default function EscalationInputs({
  accountId,
  userId,
  email,
  cardholderId,
  cardId,
  transactionId,
  depositId,
  payoutId,
  onChange,
}: EscalationInputsProps) {
  return (
    <div className="space-y-4">
      {/* Primary input */}
      <div className="space-y-1.5">
        <Label
          htmlFor="accountId"
          className="text-[13px] font-semibold text-[#111827]"
        >
          Account ID <span className="text-[#ef4444]">*</span>
        </Label>
        <Input
          id="accountId"
          placeholder="Enter Account ID"
          value={accountId}
          onChange={(e) => onChange("accountId", e.target.value)}
          className="text-sm h-10 font-mono border-[#d1d5db] focus-visible:ring-[#0a1e3d]/30 focus-visible:border-[#0a1e3d]"
        />
      </div>

      {/* Optional IDs — collapsible-style section */}
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-[#9ca3af] mb-2">
          Optional identifiers
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <IdField
            id="userId"
            label="User ID"
            value={userId}
            onChange={onChange}
            mono
          />
          <IdField
            id="email"
            label="Email"
            value={email}
            onChange={onChange}
          />
          <IdField
            id="cardholderId"
            label="Cardholder ID"
            value={cardholderId}
            onChange={onChange}
            mono
          />
          <IdField
            id="cardId"
            label="Card ID"
            value={cardId}
            onChange={onChange}
            mono
          />
          <IdField
            id="transactionId"
            label="Transaction ID"
            value={transactionId}
            onChange={onChange}
            mono
          />
          <IdField
            id="depositId"
            label="Deposit ID"
            value={depositId}
            onChange={onChange}
            mono
          />
          <IdField
            id="payoutId"
            label="Payout ID"
            value={payoutId}
            onChange={onChange}
            mono
          />
        </div>
      </div>
    </div>
  );
}

function IdField({
  id,
  label,
  value,
  onChange,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (field: string, value: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] text-[#9ca3af]">
        {label}
      </Label>
      <Input
        id={id}
        placeholder="—"
        value={value}
        onChange={(e) => onChange(id, e.target.value)}
        className={`text-[13px] h-8 border-[#e5e7eb] bg-[#fafbfc] focus-visible:ring-[#0a1e3d]/30 focus-visible:border-[#0a1e3d] ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
