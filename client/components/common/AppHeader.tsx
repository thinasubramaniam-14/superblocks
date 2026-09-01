import AirwallexLogo from "@/components/common/AirwallexLogo";

interface AppHeaderProps {
  subtitle?: string;
}

export default function AppHeader({
  subtitle = "Escalation Router",
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-3 h-12 px-5 bg-[#111111] shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
      {/* Logo */}
      <AirwallexLogo height={18} className="brightness-0 invert opacity-90" />

      {/* Separator + subtitle */}
      {subtitle && (
        <>
          <span className="h-4 w-px bg-white/20" />
          <span className="text-sm font-medium text-[#FF6B00] tracking-wide">
            {subtitle}
          </span>
        </>
      )}
    </header>
  );
}
