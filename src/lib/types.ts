export type Roommate = {
  id: string;
  name: string;
  color: string;
  created_at: string;
};

export type DishTally = {
  id: string;
  roommate_id: string;
  note: string | null;
  created_at: string;
};

export type DishCompletion = {
  performed_on: string;
  roommate_id: string;
  created_at: string;
  photo_path: string | null;
};

export type BinKind = "garbage" | "compost";

export type BinRun = {
  id: string;
  bin: BinKind;
  run_on: string;
  roommate_id: string;
  photo_path: string;
  created_at: string;
};

export type FridgeLocation = "fridge" | "freezer" | "pantry" | "household";
export type FridgeZone = "shelf" | "door" | "crisper";
export type ExpirySource = "estimated" | "manual" | "none";

export type FridgeItem = {
  id: string;
  name: string;
  quantity: string | null;
  added_by: string | null;
  expires_at: string | null;
  notes: string | null;
  consumed_at: string | null;
  created_at: string;
  location: FridgeLocation;
  expiry_source: ExpirySource;
  icon: string | null;
  zone: FridgeZone | null;
  import_batch_id: string | null;
};

export type ShelfLifeDefault = {
  keyword: string;
  location: FridgeLocation;
  shelf_life_days: number | null;
  freezer_days: number | null;
  icon: string | null;
  zone: FridgeZone | null;
};
