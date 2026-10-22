import { matchShelfLife } from "./shelf-life.ts";
import type { FridgeLocation, ShelfLifeDefault } from "./types";

/** Every illustration the fridge can show, as `public/food/<name>.webp`. */
export const FOOD_ART_NAMES = [
  "milk", "yogurt", "egg", "butter", "cheese",
  "steak", "chicken", "fish", "shrimp", "bacon", "ham", "sausage", "tofu", "leftovers", "kimchi",
  "greens", "broccoli", "carrot", "pepper", "cucumber", "mushroom", "green-onion",
  "berries", "grapes", "apple", "lemon", "banana", "avocado", "tomato", "garlic", "onion", "potato",
  "bread", "noodles", "rice", "cereal", "snacks", "cookies", "juice", "sauce", "spice",
  "frozen", "dumplings", "ice-cream",
  "paper", "soap", "garbage-bags", "sponge",
  "fallback-fridge", "fallback-freezer", "fallback-pantry",
] as const;

export type FoodArtName = (typeof FOOD_ART_NAMES)[number];

/** Which illustration each shelf-life keyword uses. Keywords not listed keep their emoji. */
export const FOOD_ART: Record<string, FoodArtName> = {
  milk: "milk", "oat milk": "milk", cream: "milk",
  yogourt: "yogurt", yogurt: "yogurt",
  egg: "egg", butter: "butter", cheese: "cheese",
  beef: "steak", steak: "steak", pork: "steak", "chuck roll": "steak",
  chicken: "chicken", fish: "fish", salmon: "fish", shrimp: "shrimp",
  bacon: "bacon", ham: "ham", sausage: "sausage", tofu: "tofu", leftover: "leftovers", kimchi: "kimchi",
  lettuce: "greens", spinach: "greens", "bok choy": "greens", cabbage: "greens",
  broccoli: "broccoli", carrot: "carrot", pepper: "pepper", cucumber: "cucumber",
  mushroom: "mushroom", enoki: "mushroom", "green onion": "green-onion",
  berry: "berries", strawberry: "berries", grape: "grapes",
  apple: "apple", lemon: "lemon", banana: "banana", avocado: "avocado", tomato: "tomato",
  garlic: "garlic", "peeled garlic": "garlic", onion: "onion", potato: "potato",
  bread: "bread", bagel: "bread",
  noodle: "noodles", ramen: "noodles", pasta: "noodles", rice: "rice", cereal: "cereal",
  "trail mix": "snacks", chip: "snacks", snack: "snacks", cookie: "cookies",
  juice: "juice", sauce: "sauce", ketchup: "sauce", mayo: "sauce", "soy sauce": "sauce", oil: "sauce",
  seasoning: "spice",
  frozen: "frozen", dumpling: "dumplings", "ice cream": "ice-cream",
  "toilet paper": "paper", "paper towel": "paper", tissue: "paper",
  "dish soap": "soap", "hand soap": "soap", detergent: "soap",
  "garbage bag": "garbage-bags", sponge: "sponge",
};

/**
 * The illustration to show for an item, or null to keep its emoji. A recognised food uses its
 * own picture; anything unrecognised uses its compartment's fallback picture.
 */
export function foodArtFor(name: string, location: FridgeLocation, defaults: ShelfLifeDefault[], available: ReadonlySet<string>): FoodArtName | null {
  const match = matchShelfLife(name, defaults);
  const art = match ? FOOD_ART[match.keyword] : location === "household" ? undefined : `fallback-${location}` as const;
  return art && available.has(art) ? art : null;
}
