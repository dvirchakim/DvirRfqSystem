const PERMITTED_COMPONENTS = new Set([
  'StatsWidget',
  'RFQTable',
  'QuickActionsBar',
  'CustomerInsights',
]);

const PERMITTED_THEMES = new Set(['light', 'dark', 'cyberpunk']);

/**
 * Validates and normalises a layout payload emitted by the agent.
 * Throws a descriptive Error on any violation.
 * Returns a clean, safe layout object on success.
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

    return { type: comp.type, props: comp.props ?? {} };
  });

  return { theme, components };
}
