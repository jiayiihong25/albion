import type { SupabaseClient } from "@supabase/supabase-js";
import type { BinRun, BinKind, Roommate } from "./types";
import { DISH_ROTATION } from "./dish-calendar.ts";
import { savePhotoCheckIn } from "./photo-check-in.ts";

export const BIN_RUN_PHOTO_BUCKET = "bin-run-photos";
export const BIN_RUN_POINTS = 2;
export const BIN_RUN_COLUMNS = "id,bin,run_on,roommate_id,photo_path,created_at";

export const BINS: Record<BinKind, { label: string; icon: string; hint: string }> = {
  garbage: { label: "Garbage", icon: "🗑️", hint: "Kitchen garbage into the outside cart" },
  compost: { label: "Compost", icon: "🍌", hint: "Kitchen compost into the green bin" },
};

export function buildBinRunLeaderboard(roommates: Pick<Roommate, "id" | "name">[], runs: Pick<BinRun, "bin" | "roommate_id">[]) {
  const scores = DISH_ROTATION.map((person) => {
    const roommate = roommates.find((r) => r.name === person.name);
    const mine = roommate ? runs.filter((run) => run.roommate_id === roommate.id) : [];
    const garbage = mine.filter((run) => run.bin === "garbage").length;
    const compost = mine.length - garbage;
    return { ...person, garbage, compost, points: mine.length * BIN_RUN_POINTS };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return scores.map((person) => ({
    ...person,
    rank: scores.findIndex((entry) => entry.points === person.points) + 1,
  }));
}

export async function saveBinRun(
  client: SupabaseClient,
  input: { file: File; bin: BinKind; day: string; roommateId: string },
  onStage?: (stage: "uploading" | "saving") => void,
) {
  return savePhotoCheckIn<BinRun>(client, {
    file: input.file, day: input.day, roommateId: input.roommateId,
    bucket: BIN_RUN_PHOTO_BUCKET, rpc: "submit_bin_run",
    args: (path) => ({ p_bin: input.bin, p_photo_path: path }),
    table: "bin_runs", columns: BIN_RUN_COLUMNS,
    duplicateMessage: `Someone already took the ${BINS[input.bin].label.toLowerCase()} out today. Refreshing…`,
  }, onStage);
}
