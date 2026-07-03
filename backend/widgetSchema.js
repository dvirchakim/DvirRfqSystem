// Single source of truth for the agent-controllable widget vocabulary.
//
// This drives three things so they can never drift apart:
//   1. validateLayout() — coerces/clamps/whitelists every prop the agent sends
//   2. the update_user_ui_layout tool JSON schema the model sees (buildLayoutToolSchema)
//   3. the human-readable widget catalog injected into the system prompt (WIDGET_CATALOG_TEXT)
//
// Every prop is declared with a type and its allowed range/enum. Anything the
// agent sends that isn't declared here is dropped — the frontend widgets only
// ever receive validated, bounded props (no arbitrary prop injection).

export const THEMES  = ['light', 'dark', 'cyberpunk'];
export const COLORS  = ['accent', 'green', 'amber', 'red', 'pink', 'text'];
export const METRICS = [
  'total', 'active', 'completed', 'high_priority', 'obsolete',
  'awaiting', 'distributed', 'ready', 'total_quantity', 'customers', 'avg_target_price',
];
export const DIMENSIONS = ['status', 'priority', 'customer'];
export const STATUSES   = ['new', 'processing', 'parsed', 'ready', 'distributed', 'awaiting', 'completed'];
export const ACTIONS    = [
  'connect_gmail', 'connect_outlook', 'manual_mode', 'send_suppliers',
  'export_excel', 'export_pdf', 'go_dashboard', 'go_inbox', 'go_settings', 'refresh',
];

// prop spec helpers
const str   = (opts = {}) => ({ kind: 'string', maxLen: opts.maxLen ?? 80 });
const text  = (opts = {}) => ({ kind: 'string', maxLen: opts.maxLen ?? 1200 });
const enm   = (values, dflt) => ({ kind: 'enum', values, default: dflt });
const int   = (min, max, dflt) => ({ kind: 'int', min, max, default: dflt });
const bool  = (dflt = false) => ({ kind: 'bool', default: dflt });
const enumList = (values, opts = {}) => ({ kind: 'enumList', values, maxItems: opts.maxItems ?? 12 });

export const WIDGETS = {
  StatsWidget: {
    desc: 'Pipeline overview: total/active/completed/high-priority counts plus a per-status breakdown.',
    props: {
      title:     str(),
      highlight: bool(false),
    },
  },
  MetricCard: {
    desc: 'One large KPI number for a single named metric.',
    props: {
      metric: enm(METRICS, 'total'),
      label:  str(),
      color:  enm(COLORS, 'accent'),
    },
  },
  BarChart: {
    desc: 'Horizontal bar chart of RFQ counts grouped by a dimension.',
    props: {
      dimension: enm(DIMENSIONS, 'status'),
      title:     str(),
      color:     enm(COLORS, 'accent'),
      limit:     int(1, 20, 8),
    },
  },
  RFQTable: {
    desc: 'Sortable table of RFQ rows with a live text filter.',
    props: {
      title:        str(),
      statusFilter: enm(['', ...STATUSES], ''),
      limit:        int(1, 100, 20),
    },
  },
  CustomerInsights: {
    desc: 'Per-customer completion progress bars and high-priority counts.',
    props: {},
  },
  MarkdownCard: {
    desc: 'A titled card of agent-authored text. Supports **bold**, *italic*, `code`, and "- " bullet lists. Use for summaries, notes, or explanations.',
    props: {
      title: str(),
      body:  text(),
      color: enm(COLORS, 'accent'),
    },
  },
  ActionButtons: {
    desc: 'A row of action buttons the user can click. Each action must be from the allowed list.',
    props: {
      title:   str(),
      actions: enumList(ACTIONS, { maxItems: 10 }),
      color:   enm(COLORS, 'amber'),
    },
  },
  QuickActionsBar: {
    desc: 'Preset shortcut buttons (Connect Gmail, Manual Mode, Send to Suppliers, Export).',
    props: {},
  },
};

export const WIDGET_TYPES = Object.keys(WIDGETS);

// ── Prop coercion ────────────────────────────────────────────────────────────
function coerceProp(spec, value) {
  switch (spec.kind) {
    case 'string': {
      if (typeof value !== 'string') return undefined;
      return value.slice(0, spec.maxLen);
    }
    case 'enum': {
      return spec.values.includes(value) ? value : undefined;
    }
    case 'int': {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return undefined;
      return Math.max(spec.min, Math.min(spec.max, n));
    }
    case 'bool': {
      if (typeof value === 'boolean') return value;
      return undefined;
    }
    case 'enumList': {
      if (!Array.isArray(value)) return undefined;
      const seen = new Set();
      const out = [];
      for (const v of value) {
        if (spec.values.includes(v) && !seen.has(v)) { seen.add(v); out.push(v); }
        if (out.length >= spec.maxItems) break;
      }
      return out;
    }
    default:
      return undefined;
  }
}

// Given a widget type and raw agent props, return only the whitelisted, coerced props.
export function coerceProps(type, rawProps = {}) {
  const spec = WIDGETS[type];
  if (!spec) return {};
  const clean = {};
  for (const [key, propSpec] of Object.entries(spec.props)) {
    if (rawProps[key] === undefined) continue;
    const coerced = coerceProp(propSpec, rawProps[key]);
    if (coerced !== undefined) clean[key] = coerced;
  }
  return clean;
}

// ── OpenRouter/OpenAI function-tool schema for update_user_ui_layout ─────────
// Built from the same WIDGETS registry so the schema the model sees always
// matches what validateLayout will accept.
function propToJsonSchema(spec) {
  switch (spec.kind) {
    case 'string': return { type: 'string', maxLength: spec.maxLen };
    case 'enum':   return { type: 'string', enum: spec.values.filter(v => v !== '') };
    case 'int':    return { type: 'integer', minimum: spec.min, maximum: spec.max };
    case 'bool':   return { type: 'boolean' };
    case 'enumList': return { type: 'array', items: { type: 'string', enum: spec.values }, maxItems: spec.maxItems };
    default:       return { type: 'string' };
  }
}

export function buildLayoutToolSchema() {
  // One "oneOf" branch per widget type: each pins `type` to a const and lists
  // that widget's specific props, so the model gets precise per-widget guidance.
  const componentSchemas = WIDGET_TYPES.map(type => {
    const props = {};
    for (const [k, spec] of Object.entries(WIDGETS[type].props)) {
      props[k] = { ...propToJsonSchema(spec), description: WIDGETS[type].desc };
    }
    return {
      type: 'object',
      properties: {
        type: { type: 'string', const: type, description: WIDGETS[type].desc },
        props: { type: 'object', properties: props, additionalProperties: false },
      },
      required: ['type'],
    };
  });

  return {
    type: 'object',
    properties: {
      theme: { type: 'string', enum: THEMES, description: 'Visual colour theme for the dashboard.' },
      components: {
        type: 'array',
        description: 'Ordered list of widgets to render (top → bottom).',
        items: { oneOf: componentSchemas },
      },
    },
    required: ['components'],
  };
}

// ── Prompt catalog ───────────────────────────────────────────────────────────
export const WIDGET_CATALOG_TEXT = WIDGET_TYPES.map(type => {
  const w = WIDGETS[type];
  const propList = Object.entries(w.props).map(([k, s]) => {
    if (s.kind === 'enum')     return `${k} (one of: ${s.values.filter(Boolean).join(', ')})`;
    if (s.kind === 'enumList') return `${k} (array from: ${s.values.join(', ')})`;
    if (s.kind === 'int')      return `${k} (integer ${s.min}–${s.max})`;
    if (s.kind === 'bool')     return `${k} (true/false)`;
    return `${k} (text)`;
  });
  return `- ${type}: ${w.desc}${propList.length ? ` Props: ${propList.join('; ')}.` : ' No props.'}`;
}).join('\n');
