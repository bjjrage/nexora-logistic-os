import "./brand.css";

export type BrandProps = {
  compact?: boolean;
  className?: string;
  onDark?: boolean;
};

export default function Brand({
  compact = false,
  className = "",
  onDark = false,
}: BrandProps) {
  const classes = [
    "nexora-brand",
    compact && "nexora-brand--compact",
    onDark && "nexora-brand--on-dark",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} role="img" aria-label="Nexora Logistic OS">
      <span className="nexora-brand__symbol" aria-hidden="true">
        <img src="/brand/nexora-original.jpg" alt="" />
      </span>
      <span className="nexora-brand__wordmark" aria-hidden="true">
        <img src="/brand/nexora-original.jpg" alt="" />
      </span>
      <span className="nexora-brand__os" aria-hidden="true">
        OS
      </span>
    </span>
  );
}
