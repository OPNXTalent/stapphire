# Stapphire — setup checklist

Everything here is a **new, isolated project** under your existing accounts.
Nothing here touches Prism's Supabase project, Prism's Stripe products, or
Prism's codebase.

## 1. GitHub

- Create a new repository (e.g. `stapphire`). Do not fork Prism's repo.
- Push everything in this folder to it.
- You'll edit through GitHub's web interface the same way you already do
  for Prism — nothing about that workflow changes.

## 2. Supabase

- Create a **new Supabase project** (Dashboard → New Project). Not a new
  schema inside the Prism project.
- Open the SQL Editor and run `supabase/schema.sql` in full.
- Go to Project Settings → API and copy:
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
    expose this in client code — `lib/supabaseAdmin.ts` is the only place
    it should be imported)
- Manually insert one row into `organizations` to get started (credits,
  name) and one `requisitions` row against it — or build a simple
  onboarding form later. For now this unblocks local testing.

## 3. Vercel

- Import the new GitHub repo as a **new Vercel project**.
- Add every variable from `.env.example` in Project Settings → Environment
  Variables.
- Deploy.

## 4. Stripe

- Same Stripe account as Prism is fine.
- Create a **new Product** (e.g. "Stapphire — Resume Evaluation Pack") with
  its own Price ID → `STRIPE_PRICE_ID_RESUME_PACK`.
- Create a **new webhook endpoint** pointing at
  `https://<your-vercel-domain>/api/stripe/webhook`, subscribed to
  `checkout.session.completed`. Copy its signing secret →
  `STRIPE_WEBHOOK_SECRET`.
- Copy your Stripe secret key → `STRIPE_SECRET_KEY` (same key as Prism
  uses is fine, since isolation here comes from separate Products/webhooks,
  not a separate account).

## 5. Anthropic

- Reuse the same `ANTHROPIC_API_KEY` as Prism. This is model access only,
  not a data store — no conflation risk.
- The evaluation logic lives entirely in `lib/systemPrompt.ts`. It is
  never combined with Prism's system prompt, and nothing in this codebase
  imports anything from Prism's repo.

## What's built vs. what's next

**Built and working:**
- Full schema for the five core objects (Requisition, Candidate,
  Evaluation, Matrix data, Collaboration)
- Resume upload → text extraction → duplicate check (silent, no credit
  charged, no re-evaluation) → AI evaluation → structured JSON → stored
- **New Requisition screen** (`/requisitions/new`) — title, plus job
  description via paste-in text or file upload (PDF/DOCX/TXT), both
  going through the same text-extraction path resumes use
- Atomic credit decrement (Postgres function, race-safe)
- Stripe checkout + webhook for credit purchases
- Collaboration event logging (append-only process history)
- Full UI: three-panel layout, collapsible side panels, Candidate Matrix
  with filters, individual Evaluation cards, Private Notes / Collaboration
  tabs — all wired to real API routes, not mock data

**Not yet built (next increments, not blockers to a first deploy):**
- Authentication (Supabase Auth is schema-ready via `profiles`, but
  sign-in/sign-up screens aren't built)
- Realtime collaboration (Supabase Realtime subscriptions — currently
  Collaboration events load on page load, not live-pushed)
- "Other Requisitions" list in the sidebar isn't fetched yet — it's
  hardcoded to an empty array in `app/page.tsx`; the API
  (`GET /api/requisitions?org_id=...`) already returns it
- `.docx` text extraction (currently falls back to raw text; a proper
  extractor like `mammoth` is a quick add — affects both resumes and
  job descriptions)
- RLS policies are enabled but left for you to write against your actual
  auth/org model — right now the API routes use the service-role key
  server-side, which is fine while there's no client-side direct DB access
