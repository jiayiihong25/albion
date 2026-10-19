import Image from "next/image";

export type HouseArtName = "house" | "dishes" | "camera" | "calendar" | "clean-sink" | "shared" | "fridge" | "trophy";

export function HouseArt({ name, size = 48, className }: { name: HouseArtName; size?: number; className?: string }) {
  return <Image src={`/illustrations/${name}.png`} alt="" width={size} height={size} sizes={`${size}px`} className={className} style={{ objectFit: "contain", flexShrink: 0 }} aria-hidden="true" />;
}
