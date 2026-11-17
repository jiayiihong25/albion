# House member login

The app uses email/password login, server-managed Supabase session cookies, and
database policies that restrict house data to the six linked roommate accounts.
No admin or service-role key is needed in the app. Normal sign-in requires no
SMTP or email delivery; only password reset emails do (see below).

## Enable Kevin first

1. Run `migrations/0003_house_auth.sql` in the project's Supabase SQL editor.
   It preserves house history, links Auth users to roommates, and replaces the
   original public database policies with member-only access.
2. In **Authentication → Users**, create the approved email as an Auth user using
   **Add user → Create new user**, if it doesn't already exist. Confirm the email
   when creating this administrator-approved account. Use a unique password for
   this member; never put it in SQL or source control. A Supabase project team
   member also needs a separate app Auth account.
3. Run `house-members.local.sql` in the SQL editor. This local, gitignored file
   links Kevin's approved email to Kevin. The result should show Kevin with
   `login_enabled = true`. The other members can stay unlinked until ready.
4. Leave public signups on: the other members create their own accounts (see
   below). Unlinked Auth users still cannot access any house data.
5. Open `/login` and sign in with that Auth account's email and password. A
   successful login returns you to the house page you were opening. Sign out
   is in the house nav.

## Let the other members join themselves

Members create their own account on the login page ("Create an account"), then
pick which unclaimed housemate they are and enter the house code. The database
checks the code, allows 5 wrong guesses per account every 15 minutes, and never
lets anyone take a housemate who's already claimed.

1. Apply `migrations/0007_house_join.sql`.
2. Set the house code in the SQL editor, then share it in the group chat. Use
   something hard to guess, like three random words:

   ```sql
   select public.set_house_code('your code here');
   ```

   Run it again to change the code (accounts that already joined stay in), or
   with `''` to switch joining off.
3. In **Authentication → Sign In / Providers**:
   - keep **Allow new users to sign up** on;
   - turn **Confirm email** off. Supabase's default email sender only delivers
     to the project's team, so other members would never get the link. Without
     a confirmation, a stranger can make an account, but it can't see anything
     without the house code.

To undo a wrong claim, clear that housemate's link in the SQL editor:
`update public.roommates set auth_user_id = null where name = 'Alex';`

Linking accounts by hand with `house-members.example.sql` still works too.

## Password reset by email

"Forgot your password?" on the login page goes to `/forgot-password`. The member
enters their email and Supabase emails a one-time link (valid for an hour). The
link opens `/auth/confirm`, where they press a button that signs them in with a
short recovery session and sends them to `/reset-password` to choose a new
password. The button matters: email security scanners (Microsoft Safe Links,
antivirus) open every link in an email first, and a link that verified on page
load would be used up before the person clicked it. Requesting a second link
also cancels the first, so only the newest email works. Saving it updates the
password in Supabase Auth, signs the account out on every device, and returns
them to `/login` to sign in with the new password. The form gives the same reply
whether or not an email has an account, so it can't be used to find members.

Setup, once:

1. **Set up custom SMTP** in **Authentication → Emails → SMTP Settings**
   (Resend, SendGrid, Postmark, or a Gmail app password all work). Supabase's
   built-in sender only delivers to the project's team members, so without this
   the other housemates never get their reset email.
2. In **Authentication → URL Configuration**, set **Site URL** to the deployed
   app (for example `https://albion.example.com`) and add
   `https://albion.example.com/auth/confirm` and
   `http://localhost:3000/auth/confirm` under **Redirect URLs**. Supabase refuses
   to send people anywhere not on this list.
3. Recommended: in **Authentication → Emails → Templates → Reset Password**,
   change the link to

   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>
   ```

   With the default template the link only works in the same browser that asked
   for it (asking on a laptop and opening the email on a phone fails). The
   `token_hash` link works on any device. `/auth/confirm` accepts both.
4. Optional: set `NEXT_PUBLIC_SITE_URL` in the app's environment to the public
   URL. Without it, the link is built from the address the request came from.

## Behavior and verification

- Unauthenticated requests to `/`, `/dishes`, and `/fridge` redirect to `/login`.
- An authenticated account still needs a linked `roommates.auth_user_id` to enter.
  Until it has one, every house page sends it to `/join`.
- Database policies deny anonymous requests and authenticated non-members.
- Dish check-ins and fridge additions use the signed-in roommate's ID. Members
  can cover any past/current dish shift but cannot claim another member's points.
- Check-in timestamps are generated by Postgres. Clients cannot provide a fake
  earlier timestamp to turn a late wash into an on-time score.
- Every member can view the calendar/leaderboard and mark shared fridge food
  consumed. Member links and completed dish records are not editable by clients.
- Passwords and session tokens are never returned in login action state or logged.
- A reset link works once. An expired or reused link lands back on
  `/forgot-password` with a note to request a new one; opening `/reset-password`
  without a recovery session offers a fresh link instead of a form.

Sources: [Supabase password auth](https://supabase.com/docs/guides/auth/passwords),
[Password reset with SSR](https://supabase.com/docs/guides/auth/passwords?flow=pkce#resetting-a-password),
[SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp).
