import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import pool from './models/db';

// Define database tables as interfaces (expand as needed)
export interface Database {
  users: {
    id: string;
    name: string;
    email: string;
    password_hash: string;
    role: 'admin' | 'manager' | 'user' | 'viewer';
    is_active: boolean;
    created_at: Date;
    oauth_provider?: string;
    oauth_access_token?: string;
    oauth_refresh_token?: string;
    oauth_expires_at?: Date;
  };
  contacts: {
    id: string;
    user_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    type: 'prospect' | 'partner' | 'vendor';
    service_line: string | null;
    notes: string | null;
    created_at: Date;
  };
  outbound_leads: {
    id: string;
    user_id: string;
    source_type: 'csv' | 'manual' | 'api' | 'other';
    source_reference: string | null;
    source_confidence: number;
    is_synthetic: boolean;
    name: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    title: string | null;
    linkedin_url: string | null;
    website: string | null;
    location: string | null;
    notes: string | null;
    raw_data: any;
    dedupe_key: string;
    fit_score: number;
    intent_score: number;
    total_score: number;
    status: string;
    next_recommended_action: string | null;
    suppression_reason: string | null;
    created_at: Date;
    updated_at: Date;
  };
  lead_source_events: {
    id: string;
    user_id: string;
    lead_id: string;
    event_type: string;
    channel: string | null;
    metadata: any;
    created_at: Date;
  };
  outbound_campaigns: {
    id: string;
    user_id: string;
    name: string;
    channels: string[];
    audience_filter: any;
    notes: string | null;
    status: string;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };
}

/**
 * Kysely query builder instance backed by the existing pg pool.
 * Use this for new/refactored queries instead of raw SQL strings.
 *
 * Example:
 *   const leads = await db
 *     .selectFrom('outbound_leads')
 *     .where('user_id', '=', userId)
 *     .where('status', '=', 'qualified')
 *     .selectAll()
 *     .execute();
 */
export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: pool as Pool,
  }),
});

export default db;
