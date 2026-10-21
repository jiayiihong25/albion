import { requireHouseMember } from "@/lib/house-member";
import FridgeInventory from "./fridge-inventory";

export default async function FridgePage() {
  const member = await requireHouseMember("/fridge");
  return <FridgeInventory member={member} />;
}
