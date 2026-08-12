# Stapphire

Minimal Hiring QC: Job Description → Requisition → Resume → Candidate Evaluation.

## Setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and configure Supabase and Anthropic credentials.
3. Run `npm install` and `npm run dev`.

Claude interprets the evidence and returns four category scores. `lib/evaluation.ts` alone calculates the displayed Match and verdict.
