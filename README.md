# The Crow Game

The Crow Game is a mobile-friendly multiplayer card game for private family tables.

## Local setup

```bash
npm install
npm run dev
```

The app currently runs in demo mode without Supabase credentials. To connect Supabase, create `.env.local`:

```bash
SUPABASE_URL=your-project-url
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Apply `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor. The schema stores one active session snapshot and aggregate statistics; individual hands, bids, tricks, and card plays are intentionally not persisted as separate records.
