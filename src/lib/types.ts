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

export type FridgeItem = {
  id: string;
  name: string;
  quantity: string | null;
  added_by: string | null;
  expires_at: string | null;
  notes: string | null;
  consumed_at: string | null;
  created_at: string;
};
