import { WIDGET_TYPES, THEMES, coerceProps } from '../widgetSchema.js';

const PERMITTED_COMPONENTS = new Set(WIDGET_TYPES);
const PERMITTED_THEMES     = new Set(THEMES);

/**
 * Validates and normalises a layout payload emitted by the agent.
 * Throws a descriptive Error on any violation.
 * Returns a clean, safe layout object on success — every component's props are
 * whitelisted and coerced to the widget's declared schema, so the frontend only
 * ever receives bounded, expected values (no arbitrary prop injection).
 */
export function validateLayout(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Layout payload must be a JSON object.');
  }

  const theme = payload.theme ?? 'dark';
  if (!PERMITTED_THEMES.has(theme)) {
    throw new Error(
      `Unknown theme "${theme}". Permitted values: ${[...PERMITTED_THEMES].join(', ')}.`
    );
  }

  if (!Array.isArray(payload.components)) {
    throw new Error('components must be an array.');
  }
  if (payload.components.length > 24) {
    throw new Error('Too many components (max 24).');
  }

  const components = payload.components.map((comp, idx) => {
    if (!comp || typeof comp !== 'object') {
      throw new Error(`Component at index ${idx} must be an object.`);
    }

    if (!PERMITTED_COMPONENTS.has(comp.type)) {
      throw new Error(
        `Unknown component type "${comp.type}" at index ${idx}. ` +
        `Permitted: ${[...PERMITTED_COMPONENTS].join(', ')}.`
      );
    }

    if (comp.props !== undefined && (typeof comp.props !== 'object' || Array.isArray(comp.props))) {
      throw new Error(`Component "${comp.type}" at index ${idx}: props must be a plain object.`);
    }

    // Whitelist + coerce props against the widget's declared schema.
    return { type: comp.type, props: coerceProps(comp.type, comp.props ?? {}) };
  });

  return { theme, components };
}
