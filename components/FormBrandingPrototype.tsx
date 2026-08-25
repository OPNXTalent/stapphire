'use client';

import { useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';
import styles from './FormBrandingPrototype.module.css';

type Palette = {
  name: string;
  primary: string;
  accent: string;
};

const PALETTES: Palette[] = [
  { name: 'Stapphire', primary: '#0d1f3c', accent: '#5b6fba' },
  { name: 'Professional Navy', primary: '#16324f', accent: '#4f7cac' },
  { name: 'Slate', primary: '#334155', accent: '#64748b' },
  { name: 'Forest', primary: '#1f4d3a', accent: '#4f8a6f' },
  { name: 'Burgundy', primary: '#642b3b', accent: '#a65b6d' },
  { name: 'Indigo', primary: '#3730a3', accent: '#6366f1' }
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
  const [primary, setPrimary] = useState(PALETTES[0].primary);
  const [accent, setAccent] = useState(PALETTES[0].accent);
  const [paletteName, setPaletteName] = useState(PALETTES[0].name);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [logoName, setLogoName] = useState('');

  const primaryText = useMemo(() => readableText(primary), [primary]);
  const previewStyle = {
    '--form-primary': primary,
    '--form-accent': accent,
    '--form-primary-text': primaryText
  } as CSSProperties;

  function choosePalette(palette: Palette) {
    setPaletteName(palette.name);
    setPrimary(palette.primary);
    setAccent(palette.accent);
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
      }
    };
    reader.readAsDataURL(file);
  }

  function reset() {
    choosePalette(PALETTES[0]);
    setLogoUrl('');
    setLogoName('');
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <span className={styles.eyebrow}>PRE-PRODUCTION EXPERIMENT</span>
        <h1>Form Branding</h1>
        <p>Customize this interview form only. Nothing here changes the Stapphire workspace or your production interview setup.</p>
      </section>

      <div className={styles.workspace}>
        <aside className={styles.controls}>
          <div className={styles.controlHeader}>
            <div>
              <span className={styles.eyebrow}>INTERVIEW FORM 1</span>
              <h2>Branding</h2>
            </div>
            <button type="button" className={styles.reset} onClick={reset}>Reset</button>
          </div>

          <div className={styles.controlGroup}>
            <label>Logo</label>
            <label className={styles.logoUpload}>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} />
              <span className={styles.uploadIcon}>↑</span>
              <span>{logoName || 'Upload logo'}</span>
              <small>PNG, JPG, WEBP or SVG</small>
            </label>
            {logoUrl && <button type="button" className={styles.removeLogo} onClick={() => { setLogoUrl(''); setLogoName(''); }}>Remove logo</button>}
          </div>

          <div className={styles.controlGroup}>
            <label>Color palette</label>
            <div className={styles.palettes}>
              {PALETTES.map((palette) => (
                <button
                  type="button"
                  key={palette.name}
                  className={`${styles.palette} ${paletteName === palette.name ? styles.paletteSelected : ''}`}
                  onClick={() => choosePalette(palette)}
                >
                  <span className={styles.swatches}>
                    <i style={{ background: palette.primary }} />
                    <i style={{ background: palette.accent }} />
                  </span>
                  <span>{palette.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.controlGroup}>
            <label>Custom colors</label>
            <div className={styles.colorRow}>
              <label>
                <span>Primary</span>
                <div className={styles.colorInput}>
                  <input type="color" value={primary} onChange={(event) => { setPaletteName('Custom'); setPrimary(event.target.value); }} />
                  <code>{primary.toUpperCase()}</code>
                </div>
              </label>
              <label>
                <span>Accent</span>
                <div className={styles.colorInput}>
                  <input type="color" value={accent} onChange={(event) => { setPaletteName('Custom'); setAccent(event.target.value); }} />
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
            <span className={styles.previewBadge}>Preview only</span>
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
              <h2>Interview Form 1 — Financial Analyst</h2>
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
                    <small>{index === 0 ? 'Not Rated' : 'Not Rated'}</small>
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
