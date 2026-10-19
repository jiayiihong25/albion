import { requireHouseMember } from "@/lib/house-member";
import Inbox from "./inbox";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const member = await requireHouseMember("/inbox");
  const { review } = await searchParams;
  const initialReview = typeof review === "string" && /^[\da-f-]{36}$/i.test(review) ? review : null;
  return <Inbox member={member} initialReview={initialReview} />;
}
