// client/src/components/OrgPicker.jsx
import { useNavigate } from 'react-router-dom'

export default function OrgPicker({ orgs }) {
  const navigate = useNavigate()

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: '1.5rem',
      background: '#f9fafb',
    }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
        Select a workspace
      </h1>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '1rem',
        maxWidth: '640px',
        width: '100%',
        padding: '0 1rem',
      }}>
        {orgs.map((org) => (
          <button
            key={org.id}
            onClick={() => navigate(`/org/${org.slug}`)}
            style={{
              padding: '1.5rem',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '0.75rem',
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
              transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.07)'}
          >
            <div style={{ fontWeight: 600, color: '#111827', marginBottom: '0.25rem' }}>
              {org.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>/{org.slug}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
