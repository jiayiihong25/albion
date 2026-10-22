"use client";

import { createContext, useContext } from "react";
import Image from "next/image";
import type { FridgeLocation, ShelfLifeDefault } from "@/lib/types";
import { foodArtFor } from "@/lib/food-art";
import { LOCATION_ICONS } from "@/lib/shelf-life";
import manifest from "@/lib/food-art-manifest.json";
import styles from "./fridge.module.css";

const AVAILABLE: ReadonlySet<string> = new Set(manifest);

/** The house's shelf-life table, so any icon can tell what food it's showing. */
export const FoodArtDefaults = createContext<ShelfLifeDefault[]>([]);

/**
 * An item's illustration from `public/food/` when there is one, otherwise its emoji. Sized in
 * em, so it follows the font size of wherever it's placed.
 */
export function FoodIcon({ name, location, emoji, className }: {
  name: string; location: FridgeLocation; emoji: string | null; className?: string;
}) {
  const defaults = useContext(FoodArtDefaults);
  const art = AVAILABLE.size ? foodArtFor(name, location, defaults, AVAILABLE) : null;
  return (
    <span className={className} aria-hidden="true">
      {art ? <Image src={`/food/${art}.webp`} alt="" width={128} height={128} unoptimized className={styles.foodArt} />
        : emoji ?? LOCATION_ICONS[location]}
    </span>
  );
}
