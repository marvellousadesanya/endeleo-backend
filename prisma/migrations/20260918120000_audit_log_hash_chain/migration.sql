-- ── Audit log hash chain ───────────────────────────────────────────────────
-- bond_audit_log already rejects UPDATE and DELETE (see bond_audit_log_no_update
-- in the bond_engine migration). That stops mutation of live rows but says nothing
-- about a row being deleted and recreated identically, or the table being restored
-- from an old backup with a gap cut out of it. The hash chain closes that: each row
-- commits to the hash of the row before it, so removing or altering any row breaks
-- verification for every row after it, not just that one.

-- CreateTable
CREATE TABLE "audit_chain_head" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "last_hash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "audit_chain_head_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_chain_head_singleton" CHECK ("id" = 1)
);

INSERT INTO "audit_chain_head" ("id", "last_hash") VALUES (1, '');

-- AlterTable
ALTER TABLE "bond_audit_log" ADD COLUMN "prev_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "bond_audit_log" ADD COLUMN "event_hash" TEXT NOT NULL DEFAULT '';

-- The chain itself. Runs BEFORE INSERT so it can rewrite NEW before the row is
-- written, and locks audit_chain_head FOR UPDATE so concurrent inserts chain in
-- commit order instead of racing to read the same prev_hash — the same pattern the
-- money procedures use to lock a bond or subscription before touching it.
CREATE OR REPLACE FUNCTION bond_audit_log_chain_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _prev TEXT;
BEGIN
  SELECT last_hash INTO _prev FROM audit_chain_head WHERE id = 1 FOR UPDATE;

  NEW.prev_hash := _prev;
  NEW.event_hash := encode(
    sha256(convert_to(
      _prev || '|' || NEW.event || '|' || COALESCE(NEW.bond_id::text, '') || '|' ||
      COALESCE(NEW.user_id::text, '') || '|' || NEW.payload::text || '|' ||
      NEW.created_at::text,
      'UTF8'
    )),
    'hex'
  );

  UPDATE audit_chain_head SET last_hash = NEW.event_hash WHERE id = 1;
  RETURN NEW;
END $$;

CREATE TRIGGER bond_audit_log_chain
  BEFORE INSERT ON bond_audit_log
  FOR EACH ROW EXECUTE FUNCTION bond_audit_log_chain_hash();
