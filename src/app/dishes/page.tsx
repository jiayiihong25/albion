import { requireHouseMember } from "@/lib/house-member";
import DishCalendar from "./dish-calendar";

export default async function DishesPage({ searchParams }: PageProps<"/dishes">) {
  const { day } = await searchParams;
  const initialDay = typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
  const member = await requireHouseMember(initialDay ? `/dishes?day=${initialDay}` : "/dishes");
  return <DishCalendar member={member} initialDay={initialDay} />;
}
