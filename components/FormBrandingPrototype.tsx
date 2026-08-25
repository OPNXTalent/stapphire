'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './FormBrandingPrototype.module.css';

type Palette = {
  name: string;
  primary: string;
  accent: string;
};

type SavedBranding = {
  paletteName?: string;
  primary?: string;
  accent?: string;
  logoUrl?: string;
  logoName?: string;
};

const PALETTES: Palette[] = [
  { name: 'Modern Indigo', primary: '#3730A3', accent: '#4F46E5' },
  { name: 'Bold Orange', primary: '#9A3412', accent: '#EA580C' },
  { name: 'Executive Slate', primary: '#334155', accent: '#0F766E' },
  { name: 'Growth Green', primary: '#166534', accent: '#047857' },
  { name: 'Deep Teal', primary: '#115E59', accent: '#0E7490' },
  { name: 'Royal Purple', primary: '#581C87', accent: '#7E22CE' },
  { name: 'Burgundy', primary: '#881337', accent: '#BE123C' },
  { name: 'Black & Gold', primary: '#18181B', accent: '#A16207' }
];

const QUESTIONS = [
  { text: 'Tell me about a time you had to explain complex information to someone who was unfamiliar with the subject.', areas: ['Communication'] },
  { text: 'Describe a situation where you had to resolve disagreement between coworkers or stakeholders.', areas: ['Conflict Management', 'Interpersonal Skills'] },
  { text: 'Tell me about a time you identified a problem before it became a larger issue. What did you do?', areas: ['Problem Solving', 'Initiative'] }
];

function readableText(hex: string) {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#ffffff';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#172033' : '#ffffff';
}

export function FormBrandingPrototype() {
  const searchParams = useSearchParams();
  const requisitionId = searchParams.get('requisitionId');
  const stage = searchParams.get('stage') || 'round-1';
  const backHref = requisitionId
    ? `/requisitions/${encodeURIComponent(requisitionId)}?view=requisition&tab=interviews`
    : '/';
  const [primary, setPrimary] = useState(PALETTES[0].primary);
  const [accent, setAccent] = useState(PALETTES[0].accent);
  const [paletteName, setPaletteName] = useState(PALETTES[0].name);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [logoName, setLogoName] = useState('');
  const [interviewTitle, setInterviewTitle] = useState('Interview Form 1');
  const [loading, setLoading] = useState(Boolean(requisitionId));
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

  const primaryText = useMemo(() => readableText(primary), [primary]);
  const previewStyle = {
    '--form-primary': primary,
    '--form-accent': accent,
    '--form-primary-text': primaryText
  } as CSSProperties;

  useEffect(() => {
    if (!requisitionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadDesign() {
      setLoading(true);
      try {
        const response = await fetch(`/api/requisitions/${encodeURIComponent(requisitionId!)}/interview-branding?stage=${encodeURIComponent(stage)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load saved design.');
        const result = await response.json();
        if (cancelled) return;
        const branding = (result?.interview?.branding ?? {}) as SavedBranding;
        setInterviewTitle(String(result?.interview?.title || 'Interview Form 1'));
        if (branding.primary && branding.accent) {
          setPrimary(branding.primary);
          setAccent(branding.accent);
          setPaletteName(branding.paletteName || 'Custom Colors');
          setLogoUrl(branding.logoUrl || '');
          setLogoName(branding.logoName || '');
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDesign();
    return () => { cancelled = true; };
  }, [requisitionId, stage]);

  function markChanged() {
    setSaveState('idle');
  }

  function choosePalette(palette: Palette) {
    setPaletteName(palette.name);
    setPrimary(palette.primary);
    setAccent(palette.accent);
    markChanged();
  }

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
        setLogoName(file.name);
        markChanged();
      }
    };
    reader.readAsDataURL(file);
  }

  function reset() {
    choosePalette(PALETTES[0]);
    setLogoUrl('');
    setLogoName('');
    markChanged();
  }

  async function saveDesign() {
    if (!requisitionId || saving) return;
    setSaving(true);
    setSaveState('idle');
    try {
      const response = await fetch(`/api/requisitions/${encodeURIComponent(requisitionId)}/interview-branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage,
          branding: { paletteName, primary, accent, logoUrl, logoName }
        })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Unable to save design.');
      setSaveState('saved');
    } catch (error) {
      console.error(error);
      setSaveState('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <div className={styles.introRow}>
          <div>
            <span className={styles.eyebrow}>INTERVIEW FORM DESIGN</span>
            <h1>Interview Form Designer</h1>
          </div>
          <a className={styles.backLink} href={backHref}>← Back to Interviews</a>
        </div>
        <p>Customize this interview form only. Your design is applied to this form, not the Stapphire workspace.</p>
      </section>

      <div className={styles.workspace}>
        <aside className={styles.controls}>
          <div className={styles.controlHeader}>
            <div>
              <span className={styles.eyebrow}>{interviewTitle.toUpperCase()}</span>
              <h2>Designer</h2>
            </div>
            <div className={styles.controlActions}>
              <button type="button" className={styles.reset} onClick={reset} disabled={loading || saving}>Reset</button>
              <button type="button" className={styles.saveDesign} onClick={saveDesign} disabled={!requisitionId || loading || saving}>
                {saving ? 'Saving…' : saveState === 'saved' ? '✓ Design Saved' : 'Save Design'}
              </button>
            </div>
          </div>
          {saveState === 'error' && <p className={styles.saveError}>Design could not be saved. Please try again.</p>}

          <div className={styles.controlGroup}>
            <label>Logo</label>
            <label className={styles.logoUpload}>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} />
              <span className={styles.uploadIcon}>↑</span>
              <span>{logoName || 'Upload logo'}</span>
              <small>PNG, JPG, WEBP or SVG</small>
            </label>
            {logoUrl && <button type="button" className={styles.removeLogo} onClick={() => { setLogoUrl(''); setLogoName(''); markChanged(); }}>Remove logo</button>}
          </div>

          <div className={styles.controlGroup}>
            <label>Corporate Color Palette</label>
            <div className={styles.palettes}>
              {PALETTES.map((palette, index) => {
                const selected = paletteName === palette.name;
                return (
                  <button
                    type="button"
                    key={palette.name}
                    className={`${styles.palette} ${selected ? styles.paletteSelected : ''}`}
                    onClick={() => choosePalette(palette)}
                    aria-pressed={selected}
                  >
                    <span className={styles.swatches}>
                      <i style={{ background: palette.primary }} />
                      <i style={{ background: palette.accent }} />
                    </span>
                    <span className={styles.paletteLabel}>
                      <span>{palette.name}{index === 0 ? ' — Default' : ''}</span>
                      {selected && <span className={styles.selectedBadge}>✓ Selected</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.controlGroup}>
            <label>Custom Colors</label>
            <div className={styles.colorRow}>
              <label>
                <span>Primary</span>
                <div className={styles.colorInput}>
                  <input type="color" value={primary} onChange={(event) => { setPaletteName('Custom Colors'); setPrimary(event.target.value); markChanged(); }} />
                  <code>{primary.toUpperCase()}</code>
                </div>
              </label>
              <label>
                <span>Accent</span>
                <div className={styles.colorInput}>
                  <input type="color" value={accent} onChange={(event) => { setPaletteName('Custom Colors'); setAccent(event.target.value); markChanged(); }} />
                  <code>{accent.toUpperCase()}</code>
                </div>
              </label>
            </div>
          </div>

          <div className={styles.note}>
            <strong>Form-level only</strong>
            <span>Brand choices belong to this interview form—not the workspace.</span>
          </div>
        </aside>

        <section className={styles.previewShell}>
          <div className={styles.previewToolbar}>
            <div>
              <span className={styles.eyebrow}>LIVE PREVIEW</span>
              <strong>What the interviewer will see</strong>
            </div>
            <span className={styles.previewBadge}>{saveState === 'saved' ? 'Saved' : 'Preview'}</span>
          </div>

          <div className={styles.formPage} style={previewStyle}>
            <header className={styles.formHeader}>
              <div className={styles.formBrandRow}>
                {logoUrl ? (
                  <div className={styles.logoFrame}><img src={logoUrl} alt="Uploaded company logo" /></div>
                ) : (
                  <div className={styles.logoPlaceholder}>YOUR LOGO</div>
                )}
                <span className={styles.formPreviewLabel}>INTERVIEW EVALUATION</span>
              </div>
              <h2>{interviewTitle} — Financial Analyst</h2>
              <div className={styles.formContext}>
                <span><strong>Candidate</strong> Jordan Taylor</span>
                <span><strong>Progress</strong> 0 of 4 ratings</span>
              </div>
            </header>

            <section className={styles.participantCard}>
              <label>Your name</label>
              <input placeholder="Enter your name" disabled />
            </section>

            <div className={styles.questionList}>
              {QUESTIONS.map((question, index) => (
                <section className={styles.questionCard} key={question.text}>
                  <div className={styles.questionHeading}>
                    <span>Q{index + 1}</span>
                    <strong>{question.text}</strong>
                    <small>Not Rated</small>
                  </div>
                  {index === 0 && (
                    <div className={styles.ratingPanel}>
                      <div className={styles.ratingHeader}><span>Area of Evaluation</span><span>Rating</span></div>
                      {question.areas.map((area) => (
                        <div className={styles.ratingRow} key={area}>
                          <span>{area}</span>
                          <span className={styles.stars}>☆ ☆ ☆ ☆ ☆</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>

            <section className={styles.assessment}>
              <div className={styles.assessmentHeader}>
                <strong>Overall Assessment</strong>
                <span>Required to submit</span>
              </div>
              <label>Comments<textarea placeholder="Add interview comments…" disabled /></label>
              <label>Recommendation<select disabled><option>Select a recommendation</option></select></label>
              <button type="button" disabled>Submit Interview</button>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
