/* eslint-disable @next/next/no-img-element -- ImageResponse draws plain <img> tags. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { dishShareCopy, dishTeaserUrl } from "@/lib/dish-shares";
import { getDishShare } from "./share-data";

export const alt = "A dish check-in from the Albion house";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const art = (file: string) => readFile(join(process.cwd(), "public", "share", file), "base64").then((data) => `data:image/png;base64,${data}`);

async function teaser(token: string) {
  try {
    const response = await fetch(dishTeaserUrl(token), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    return `data:image/jpeg;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await getDishShare(token);
  const person = DISH_ROTATION.find((entry) => entry.name === share?.washer);
  const copy = share ? dishShareCopy(share) : { title: "Dish duty at Albion", detail: "Six people. One sink." };
  const [photo, avatar, sink] = await Promise.all([
    share?.has_teaser ? teaser(token) : null,
    art(person ? `${person.name.toLowerCase()}.png` : "shared.png"),
    art("clean-sink.png"),
  ]);
  const tint = person?.color ?? "#e9eedf";

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffef8", color: "#25382e" }}>
      <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: tint, overflow: "hidden" }}>
        {photo
          ? <img alt="" src={photo} width={1240} height={460} style={{ position: "absolute", left: -20, top: -20, width: 1240, height: 460, objectFit: "cover" }} />
          : <img alt="" src={sink} width={300} height={300} />}
        {photo && <div style={{ display: "flex", background: "rgba(255,254,248,0.9)", padding: "16px 34px", borderRadius: 999, fontSize: 34, fontWeight: 600 }}>tap to see the sink</div>}
      </div>
      <div style={{ height: 210, display: "flex", alignItems: "center", gap: 34, padding: "0 56px" }}>
        <div style={{ width: 140, height: 140, borderRadius: 70, background: tint, display: "flex", overflow: "hidden" }}>
          <img alt="" src={avatar} width={140} height={140} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 46, letterSpacing: -1 }}>{copy.title.replace(/\s*✓$/, "")}</div>
          <div style={{ display: "flex", fontSize: 34, color: "#757b70", marginTop: 6 }}>{copy.detail}</div>
        </div>
        {share && <div style={{ width: 96, height: 96, borderRadius: 48, background: share.on_time ? "#71a26e" : "#c9a14a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="52" height="52" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fffef8" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>}
      </div>
    </div>,
    size,
  );
}
