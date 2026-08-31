import AirwallexLogo from "@/components/common/AirwallexLogo";

interface AppHeaderProps {
  /** Optional subtitle shown to the right of a separator */
  subtitle?: string;
}

export default function AppHeader({ subtitle = "Escalation Router" }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-3 h-12 px-5 bg-[#0a1e3d] shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
      {/* Logo — the PNG is dark text on transparent; we use the brightness/invert filter to make it white */}
      <AirwallexLogo height={18} className="brightness-0 invert opacity-90" />

      {/* Separator + subtitle */}
      {subtitle && (
        <>
          <span className="h-4 w-px bg-white/25" />
          <span className="text-sm font-medium text-white/80 tracking-wide">
            {subtitle}
          </span>
        </>
      )}
    </header>
  );
}
