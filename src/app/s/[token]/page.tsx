import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { dishShareCopy, dishTeaserUrl } from "@/lib/dish-shares";
import { getDishShare } from "./share-data";
import styles from "./share.module.css";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const share = await getDishShare((await params).token);
  if (!share) return { title: "Albion", robots: { index: false } };
  const copy = dishShareCopy(share);
  return {
    title: copy.title,
    description: copy.detail,
    robots: { index: false },
    openGraph: { title: copy.title, description: copy.detail, siteName: "Albion", type: "website" },
  };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const share = await getDishShare(token);
  if (!share) notFound();
  const copy = dishShareCopy(share);
  const person = DISH_ROTATION.find((entry) => entry.name === share.washer);
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.teaser} style={{ background: person?.color ?? "#e9eedf" }}>
          {share.has_teaser
            // The teaser is already a few KB; optimizing would only delay it.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={dishTeaserUrl(token)} alt="" className={styles.teaserImage} />
            : <Image src="/share/clean-sink.png" alt="" width={160} height={160} className={styles.sinkArt} />}
          {share.has_teaser && <span className={styles.peek}>Sign in to see the sink</span>}
        </div>
        <div className={styles.badge}>
          <span className={styles.avatar} style={{ background: person?.color ?? "#e8e5de" }}>
            <Image src={`/share/${person ? share.washer.toLowerCase() : "shared"}.png`} alt="" width={64} height={64} />
          </span>
          <div><h1>{copy.cardTitle} ✓</h1><p>{copy.detail}</p></div>
        </div>
        <Link href={`/dishes?day=${share.performed_on}`} className={styles.button}>See it in Albion</Link>
        <p className={styles.footnote}>albion · six people, one sink</p>
      </div>
    </main>
  );
}
