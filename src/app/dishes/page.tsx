import { requireHouseMember } from "@/lib/house-member";
import DishCalendar from "./dish-calendar";

export default async function DishesPage() {
  const member = await requireHouseMember("/dishes");
  return <DishCalendar member={member} />;
}
