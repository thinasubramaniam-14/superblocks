/**
 * Airwallex wordmark rendered as an <img> pointing at the public brand asset
 * with a local SVG icon fallback.
 */
interface AirwallexLogoProps {
  className?: string;
  height?: number;
}

export default function AirwallexLogo({
  className = "",
  height = 22,
}: AirwallexLogoProps) {
  return (
    <img
      src="https://upload.wikimedia.org/wikipedia/commons/4/47/Airwallex_logo_%282025%29.png"
      alt="Airwallex"
      height={height}
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}
