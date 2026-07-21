CREATE TABLE health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON health_snapshots TO service_role;

CREATE TRIGGER health_snapshots_updated_at
  BEFORE UPDATE ON health_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
