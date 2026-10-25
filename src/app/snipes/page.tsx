import { requireHouseMember } from "@/lib/house-member";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { HouseNav } from "@/components/house-nav";
import shell from "@/components/house-shell.module.css";
import { SnipeBoard } from "./snipe-board";

export default async function SnipesPage({ searchParams }: PageProps<"/snipes">) {
  const { person } = await searchParams;
  const initialPerson = DISH_ROTATION.find((entry) => entry.name === person)?.name;
  const member = await requireHouseMember(initialPerson ? `/snipes?person=${initialPerson}` : "/snipes");
  return (
    <main className={shell.page}>
      <div className={shell.shell}>
        <HouseNav member={member} section="snipes" />
        <header className={shell.header}>
          <div><p className={shell.eyebrow}>LEFT IN THE SINK</p><h1>Dish snipes<span>.</span></h1><p className={shell.subtitle}>Spot a crusty bowl, snap it, tag whose it is. It costs them a point unless the house lets it go.</p></div>
          <span className={shell.houseTag}><span /> NO SCORES FOR SNIPERS</span>
        </header>
        <SnipeBoard member={member} initialPerson={initialPerson} />
        <footer className={shell.footer}><span>Judge the dish, not the person.</span><span>House time · Toronto</span></footer>
      </div>
    </main>
  );
}
