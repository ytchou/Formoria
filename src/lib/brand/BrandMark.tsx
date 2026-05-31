import { brand } from "./colors";

interface BrandMarkProps {
  color?: string;
  size?: number;
}

export function BrandMark({ color = brand.primary, size = 32 }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill={color}>
      <path d="M16 3.5 26.6 12.7c1.2 1 1 2.9-.4 3.6l-8.3 4.3 3.7 5.4c.8 1.2-.1 2.8-1.5 2.8h-8.2c-1.4 0-2.3-1.6-1.5-2.8l3.7-5.4-8.3-4.3c-1.4-.7-1.6-2.6-.4-3.6L16 3.5Z" />
    </svg>
  );
}
