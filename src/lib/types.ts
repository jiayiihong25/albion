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
};

export type DishSubmission = {
  id: string;
  performed_on: string;
  roommate_id: string;
  photo_path: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  decided_at: string | null;
  photo_deleted_at: string | null;
};

export type DishVote = { submission_id: string; voter_id: string; approved: boolean; created_at: string };
export type HouseNotification = {
  id: string;
  recipient_id: string;
  submission_id: string;
  kind: "review_requested" | "approved" | "rejected";
  created_at: string;
  read_at: string | null;
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
