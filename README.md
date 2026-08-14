# Stapphire

Minimal Hiring QC: Job Description → Requisition → Resume → Candidate Evaluation.

## Setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and configure Supabase and Anthropic credentials.
3. Run `npm install` and `npm run dev`.

The evaluator interprets the evidence and returns four category scores. `lib/evaluation.ts` alone calculates the displayed Match. Recruiter-controlled disposition remains separate from evaluation.
