import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the password reset email lands. Trades the link's one-time code for a
 * short recovery session, then sends the person on to choose a new password.
 *
 * Handles both link styles: `?token_hash=…&type=recovery` (works on any device,
 * needs the email template from supabase/AUTH_SETUP.md) and the default
 * `?code=…` (works only in the browser that asked for the link).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  let ok = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && (code || (tokenHash && type === "recovery"))) {
    try {
      const supabase = await createClient();
      const { error } = tokenHash
        ? await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })
        : await supabase.auth.exchangeCodeForSession(code!);
      ok = !error;
    } catch {
      ok = false;
    }
  }

  const destination = new URL(ok ? "/reset-password" : "/forgot-password?error=link", request.url);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
