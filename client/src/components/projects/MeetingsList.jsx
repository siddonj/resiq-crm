import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';

export default function MeetingsList({ projectId, meetings = [], tasks = [], members = [], onReload }) {
  const { token, user } = useAuth();
  const headers = { headers: { Authorization: `Bearer ${token}` } };

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [minutes, setMinutes] = useState('');
  const [selectedAttendees, setSelectedAttendees] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [error, setError] = useState('');

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setStartTime('');
    setEndTime('');
    setLocation('');
    setAgenda('');
    setMinutes('');
    setSelectedAttendees([]);
    setSelectedTasks([]);
    setError('');
    setShowForm(true);
  };

  const openEdit = (m) => {
    setEditing(m);
    setTitle(m.title);
    setStartTime(m.start_time ? new Date(m.start_time).toISOString().slice(0, 16) : '');
    setEndTime(m.end_time ? new Date(m.end_time).toISOString().slice(0, 16) : '');
    setLocation(m.location || '');
    setAgenda(m.agenda || '');
    setMinutes(m.minutes || '');
    setSelectedAttendees(m.attendees?.map((a) => a.user_id) || []);
    setSelectedTasks(m.linked_tasks?.map((t) => t.task_id) || []);
    setError('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !startTime) return setError('Title and start time are required');
    const payload = {
      title: title.trim(),
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : null,
      location: location || null,
      agenda: agenda || null,
      minutes: minutes || null,
      attendee_ids: selectedAttendees,
      task_ids: selectedTasks,
    };
    try {
      if (editing) {
        await axios.put(`/api/projects/${projectId}/meetings/${editing.id}`, payload, headers);
      } else {
        await axios.post(`/api/projects/${projectId}/meetings`, payload, headers);
      }
      setShowForm(false);
      onReload();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save meeting');
    }
  };

  const handleDelete = async (m) => {
    if (!window.confirm(`Delete meeting "${m.title}"?`)) return;
    try {
      await axios.delete(`/api/projects/${projectId}/meetings/${m.id}`, headers);
      onReload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete meeting');
    }
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const now = new Date();
  const upcoming = meetings.filter((m) => new Date(m.start_time) >= now);
  const past = meetings.filter((m) => new Date(m.start_time) < now);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Meetings</h3>
        <button onClick={openNew} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
          + Schedule Meeting
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {showForm && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">{editing ? 'Edit Meeting' : 'New Meeting'}</h4>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Title</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Start</label>
                <input type="datetime-local" className="w-full rounded-md border-gray-300 text-sm" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">End</label>
                <input type="datetime-local" className="w-full rounded-md border-gray-300 text-sm" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Location</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room, Zoom link, etc." />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Agenda</label>
              <textarea className="w-full rounded-md border-gray-300 text-sm" rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Minutes</label>
              <textarea className="w-full rounded-md border-gray-300 text-sm" rows={2} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Attendees</label>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto border rounded-md p-2">
                {members.map((m) => (
                  <label key={m.user_id || m.id} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAttendees.includes(m.user_id || m.id)}
                      onChange={(e) => {
                        const id = m.user_id || m.id;
                        setSelectedAttendees((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)));
                      }}
                    />
                    {m.user_name || m.name || m.email}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Linked Tasks</label>
              <select
                multiple
                className="w-full rounded-md border-gray-300 text-sm"
                value={selectedTasks}
                onChange={(e) => {
                  const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setSelectedTasks(opts);
                }}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.task_id || t.id.slice(0, 8)} — {t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
                {editing ? 'Update' : 'Schedule'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {meetings.length === 0 && !showForm && (
        <div className="text-sm text-gray-500">No meetings scheduled yet.</div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Upcoming</h4>
          <div className="space-y-2">
            {upcoming.map((m) => (
              <MeetingCard key={m.id} meeting={m} onEdit={openEdit} onDelete={handleDelete} formatTime={formatTime} />
            ))}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Past</h4>
          <div className="space-y-2">
            {past.map((m) => (
              <MeetingCard key={m.id} meeting={m} onEdit={openEdit} onDelete={handleDelete} formatTime={formatTime} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingCard({ meeting, onEdit, onDelete, formatTime }) {
  const [expanded, setExpanded] = useState(false);
  const start = new Date(meeting.start_time);
  const isPast = start < new Date();

  return (
    <div className={`border rounded-lg p-3 ${isPast ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h5 className="text-sm font-semibold text-gray-900">{meeting.title}</h5>
            {meeting.location && (
              <span className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{meeting.location}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {formatTime(meeting.start_time)}
            {meeting.end_time && ` — ${formatTime(meeting.end_time)}`}
          </div>
          {meeting.attendees?.length > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-gray-400">Attendees:</span>
              <div className="flex -space-x-1">
                {meeting.attendees.slice(0, 5).map((a) => (
                  <span key={a.user_id} className="inline-block w-4 h-4 rounded-full bg-indigo-100 text-[8px] text-indigo-700 flex items-center justify-center border border-white" title={a.user_name || a.user_email}>
                    {(a.user_name || a.user_email || '?').charAt(0).toUpperCase()}
                  </span>
                ))}
                {meeting.attendees.length > 5 && (
                  <span className="inline-block w-4 h-4 rounded-full bg-gray-100 text-[8px] text-gray-600 flex items-center justify-center border border-white">
                    +{meeting.attendees.length - 5}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded((p) => !p)} className="text-xs px-2 py-1 rounded hover:bg-gray-100 text-gray-500">
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button onClick={() => onEdit(meeting)} className="text-xs px-2 py-1 rounded hover:bg-gray-100 text-gray-500" title="Edit">
            ✎
          </button>
          <button onClick={() => onDelete(meeting)} className="text-xs px-2 py-1 rounded hover:bg-red-50 text-red-500" title="Delete">
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          {meeting.agenda && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase">Agenda</span>
              <p className="text-xs text-gray-700 whitespace-pre-line">{meeting.agenda}</p>
            </div>
          )}
          {meeting.minutes && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase">Minutes</span>
              <p className="text-xs text-gray-700 whitespace-pre-line">{meeting.minutes}</p>
            </div>
          )}
          {meeting.linked_tasks?.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase">Linked Tasks</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {meeting.linked_tasks.map((t) => (
                  <span key={t.task_id} className="text-[10px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5 border border-indigo-100">
                    {t.task_task_id || t.task_id.slice(0, 8)} — {t.task_name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {meeting.attendees?.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase">Attendee Status</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {meeting.attendees.map((a) => (
                  <span key={a.user_id} className={`text-[10px] rounded px-1.5 py-0.5 border ${
                    a.status === 'accepted' ? 'bg-green-50 text-green-700 border-green-100' :
                    a.status === 'declined' ? 'bg-red-50 text-red-700 border-red-100' :
                    a.status === 'tentative' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    'bg-gray-50 text-gray-600 border-gray-100'
                  }`}>
                    {a.user_name || a.user_email || a.user_id.slice(0, 6)} ({a.status})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
