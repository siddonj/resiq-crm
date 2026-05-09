export function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatCurrency(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(number);
}

export function renderStatusBadge(status) {
  const normalized = String(status || 'new');
  const classes = {
    new: 'bg-slate-100 text-slate-700',
    qualified: 'bg-blue-100 text-blue-700',
    queued: 'bg-indigo-100 text-indigo-700',
    contacted: 'bg-amber-100 text-amber-700',
    replied: 'bg-emerald-100 text-emerald-700',
    meeting: 'bg-teal-100 text-teal-700',
    opportunity: 'bg-green-100 text-green-700',
    disqualified: 'bg-rose-100 text-rose-700',
    suppressed: 'bg-zinc-100 text-zinc-700',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${classes[normalized] || classes.new}`}>
      {normalized}
    </span>
  );
}

export function downloadBlobFile(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(objectUrl);
}

export const MULTIFAMILY_OBJECT_TYPES = [
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'property', label: 'Property' },
  { value: 'tech_stack', label: 'Tech Stack' },
  { value: 'initiative', label: 'Initiative' },
];
