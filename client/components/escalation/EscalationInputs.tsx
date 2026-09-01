import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EscalationInputsProps {
  accountId: string;
  cle: string;
  onChange: (field: string, value: string) => void;
}

export default function EscalationInputs({
  accountId,
  cle,
  onChange,
}: EscalationInputsProps) {
  return (
    <div className="space-y-3">
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
          className="text-sm h-10 font-mono border-[#d1d5db] focus-visible:ring-[#FF6B00]/30 focus-visible:border-[#FF6B00]"
        />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="cle"
          className="text-[13px] font-semibold text-[#111827]"
        >
          CLE{" "}
          <span className="font-normal text-[#9ca3af]">
            (Client Legal Entity)
          </span>
        </Label>
        <Input
          id="cle"
          placeholder="Optional — filter by legal entity"
          value={cle}
          onChange={(e) => onChange("cle", e.target.value)}
          className="text-sm h-10 border-[#d1d5db] focus-visible:ring-[#FF6B00]/30 focus-visible:border-[#FF6B00]"
        />
      </div>
    </div>
  );
}
