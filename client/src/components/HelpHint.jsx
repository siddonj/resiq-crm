import { Link } from 'react-router-dom'

function buildHelpHref({ topic, tab }) {
  const params = new URLSearchParams()
  if (tab) params.set('tab', tab)
  if (topic) params.set('q', topic)
  const query = params.toString()
  return query ? `/help?${query}` : '/help'
}

export default function HelpHint({
  topic,
  tab = 'faq',
  text = 'Help',
  detail,
  className = '',
}) {
  const href = buildHelpHref({ topic, tab })
  const title = detail ? `${text}: ${detail}` : text

  return (
    <Link
      to={href}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1 rounded-full border border-teal/30 bg-teal/5 px-2 py-1 text-[11px] font-semibold text-teal hover:bg-teal/10 ${className}`}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-teal/40 text-[10px] leading-none">
        ?
      </span>
      <span>{text}</span>
    </Link>
  )
}
