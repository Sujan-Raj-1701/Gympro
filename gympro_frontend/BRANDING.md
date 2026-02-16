# GYM Pro branding updates

Date: 2025-10-24

Changes applied to align the app with salon management branding and the new login screen design:

- index.html: Updated page title and added SEO meta description for GYM Pro.
- Layout.tsx: Replaced old BanquetPro labels with GYM Pro (aria-label, alt text, sr-only).
- Login.tsx: Uses a purple gradient hero with salon-focused copy and module highlights; no code change needed here.
- Theme: Primary color remains indigo/violet via Tailwind tokens in `client/global.css`.

How to verify
- Build the frontend or run the dev server and open /login.
- Confirm the left panel shows GYM Pro messaging and the right panel shows the sign-in form.
- Inspect the header logo area and ensure its accessible labels say "GYM Pro".

Next ideas (non-breaking)
- Update favicon assets with GYM Pro logo.
- Add a marketing/landing route for public viewing (no auth) if required.
