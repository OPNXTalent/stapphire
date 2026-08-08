'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import './landing.css';

function Gem() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#lpGem)" />
      <polygon points="12,1 21,7 12,9" fill="#fff" opacity="0.22" />
      <polygon points="3,7 12,1 12,9" fill="#fff" opacity="0.1" />
      <polygon points="0,14 3,7 12,9 7,23" fill="#0A2452" opacity="0.35" />
      <polygon points="24,14 21,7 12,9 17,23" fill="#0A2452" opacity="0.2" />
      <defs>
        <linearGradient id="lpGem" x1="0" y1="0" x2="24" y2="23">
          <stop offset="0%" stopColor="#5C87F5" />
          <stop offset="100%" stopColor="#123A8F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/signups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, company, team_size: teamSize })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Something went wrong');
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="lp-form-success">
        <div className="lp-form-success-check">✓</div>
        <h3>You're on the list.</h3>
        <p>Someone from our team will reach out shortly to get your workspace set up.</p>
      </div>
    );
  }

  return (
    <form className="lp-form" onSubmit={handleSubmit} id="get-started">
      <div className="lp-form-row">
        <input className="lp-input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          className="lp-input"
          type="email"
          placeholder="Work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="lp-form-row">
        <input className="lp-input" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
        <select className="lp-select" value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
          <option value="">Team size</option>
          <option value="1-10">1–10</option>
          <option value="11-50">11–50</option>
          <option value="51-200">51–200</option>
          <option value="200+">200+</option>
        </select>
      </div>
      <button className="lp-form-submit" type="submit" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Get Started'}
      </button>
      {error && <div className="lp-form-error">{error}</div>}
      <div className="lp-form-hint">No credit card required. We'll set up your workspace personally.</div>
    </form>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      <nav className={`lp-nav ${scrolled ? 'lp-nav-scrolled' : ''}`}>
        <div className="lp-nav-brand">
          <Gem />
          <span className="lp-nav-word">Stapphire</span>
          <span className="lp-nav-tag">Hiring Quality Control</span>
        </div>
        <div className="lp-nav-actions">
          <a className="lp-nav-link" href="#how-it-works">
            How it works
          </a>
          <Link className="lp-nav-link" href="/login">
            Sign In
          </Link>
          <a className="lp-nav-cta" href="#get-started">
            Get Started
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div>
            <div className="lp-eyebrow">Hiring Quality Control</div>
            <h1>
              Every candidate.
              <br />
              Same standard.
              <br />
              <em>Full evidence.</em>
            </h1>
            <p className="lp-hero-sub">
              Stapphire builds a living standard for what a role actually needs, then shows exactly why each candidate
              does or doesn't fit — not a keyword scanner guessing in the dark.
            </p>
            <div className="lp-hero-ctas">
              <a className="lp-btn-primary" href="#get-started">
                Get Started
              </a>
              <a className="lp-link-ghost" href="#how-it-works">
                See how it works ↓
              </a>
            </div>
          </div>

          <div className="lp-card-wrap">
            <div className="lp-evidence-card">
              <div className="lp-ev-head">
                <div>
                  <div className="lp-ev-name">Morgan Ellis</div>
                  <div className="lp-ev-role">Customer Success Manager</div>
                </div>
                <div className="lp-ev-score">
                  <div className="lp-ev-num">88%</div>
                  <div className="lp-ev-badge">Recommend Interview</div>
                </div>
              </div>

              <div className="lp-ev-section">
                <div className="lp-ev-label">
                  <span className="lp-ev-dot" style={{ background: '#2E9E52' }} />
                  Why
                </div>
                <div className="lp-ev-item">3+ years leading enterprise renewals with measurable retention gains</div>
                <div className="lp-ev-item">Fluent in Salesforce and HubSpot from current role</div>
              </div>

              <div className="lp-ev-section">
                <div className="lp-ev-label">
                  <span className="lp-ev-dot" style={{ background: '#C08A1E' }} />
                  What to Verify
                </div>
                <div className="lp-ev-item">Weekend on-call rotation — not addressed in résumé, confirm at interview</div>
              </div>

              <div className="lp-ev-section">
                <div className="lp-ev-label">
                  <span className="lp-ev-dot" style={{ background: '#1E4FD8' }} />
                  Trainable After Hire
                </div>
                <div className="lp-ev-item">Internal ticketing system — proprietary, covered in onboarding</div>
              </div>

              <div className="lp-ev-section" style={{ marginBottom: 0 }}>
                <div className="lp-ev-label">
                  <span className="lp-ev-dot" style={{ background: '#B02A2A' }} />
                  Gap
                </div>
                <div className="lp-ev-item">No direct SaaS industry experience</div>
              </div>
            </div>
            <div className="lp-float-tag lp-float-tag-1">Same standard. Every candidate.</div>
          </div>
        </div>
      </header>

      {/* ── Process ── */}
      <section className="lp-process" id="how-it-works">
        <div className="lp-wrap">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">How it works</div>
            <h2>Not a one-time scan. A standard you actually shape.</h2>
          </div>
          <div className="lp-process-grid">
            <div className="lp-process-step">
              <div className="lp-process-num">01</div>
              <h3>Tell us what the role needs</h3>
              <p>Paste a job description, upload one, or just talk it through — Stapphire parses it into a real, weighted rubric.</p>
            </div>
            <div className="lp-process-step">
              <div className="lp-process-num">02</div>
              <h3>Refine it in conversation</h3>
              <p>
                "That system doesn't matter, we train it." "Communication matters more than the degree." Say it once, and
                the standard updates for every candidate — not just the one you're looking at.
              </p>
            </div>
            <div className="lp-process-step">
              <div className="lp-process-num">03</div>
              <h3>Every candidate, same bar</h3>
              <p>Full evidence, categorized honestly — what's missing, what's just unconfirmed, and what the job itself will teach.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contrast ── */}
      <section className="lp-contrast">
        <div className="lp-wrap">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">The difference</div>
            <h2>Keyword scanners guess. Stapphire shows its work.</h2>
          </div>
          <div className="lp-contrast-grid">
            <div className="lp-contrast-col lp-bad">
              <div className="lp-contrast-title">Typical ATS scoring</div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✕</span>
                Docks points for missing exact phrases, even when the capability is clearly there
              </div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✕</span>
                Treats anything unconfirmed on a résumé as a failure
              </div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✕</span>
                One rigid rubric, set once, never revisited
              </div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✕</span>
                A black-box percentage with no way to see why
              </div>
            </div>
            <div className="lp-contrast-col lp-good">
              <div className="lp-contrast-title">Stapphire</div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✓</span>
                Credits real, demonstrated capability — however it's worded
              </div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✓</span>
                Separates what's genuinely missing from what's simply unconfirmed
              </div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✓</span>
                A living standard that evolves as you clarify what you actually need
              </div>
              <div className="lp-contrast-row">
                <span className="lp-contrast-icon">✓</span>
                Every score traces back to evidence you can actually read
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta-band">
        <div className="lp-wrap">
          <h2>See it on your own requisition.</h2>
          <p>Tell us a bit about your team, and we'll get you set up — no credit card, no long onboarding call required.</p>
          <SignupForm />
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div className="lp-footer-brand">
            <Gem />
            <span className="lp-footer-word">Stapphire</span>
            <span>— an OPNX workspace</span>
          </div>
          <div className="lp-footer-copy">© {new Date().getFullYear()} OPNX LLC</div>
        </div>
      </footer>
    </div>
  );
}
