import type { ToolSpec } from '@itp/core';
import { cellText, type Row } from './logic';

export type DetailProps = {
  spec: ToolSpec;
  row: Row;
  /** Labels for fields, defaulting to the field name. */
  labels?: Readonly<Record<string, string>>;
};

/**
 * Sectioned field layout. Values are rendered exactly as the data-access layer
 * returned them: masking is a core concern (§3.5) and the component must never
 * be able to un-mask by rendering something else.
 */
export function Detail({ spec, row, labels }: DetailProps) {
  return (
    <div className="detail">
      {spec.detail.sections.map((section) => (
        <section key={section.label} className="detail-section">
          <h3>{section.label}</h3>
          <dl>
            {section.fields.map((field) => {
              const text = cellText(row[field]);
              const masked = isMaskedValue(text);
              return (
                <div key={field} className="detail-row">
                  <dt>{labels?.[field] ?? field}</dt>
                  <dd className={masked ? 'value masked' : 'value'}>
                    {text}
                    {masked ? <span className="masked-tag" title="Masked by PII policy">masked</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Presentation-only heuristic: core owns what masking means, we only style it. */
function isMaskedValue(text: string): boolean {
  return text.includes('*') || text === '[redacted]';
}
