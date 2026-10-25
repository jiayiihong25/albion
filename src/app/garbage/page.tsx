import { requireHouseMember } from "@/lib/house-member";
import BinRuns from "./bin-runs";

export default async function GarbagePage() {
  const member = await requireHouseMember("/garbage");
  return <BinRuns member={member} />;
}
