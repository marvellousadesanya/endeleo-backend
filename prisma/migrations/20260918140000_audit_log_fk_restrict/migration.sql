-- Makes the audit log's foreign keys say what actually happens.
--
-- Both were ON DELETE SET NULL, but nulling bond_id/user_id is an UPDATE, and
-- bond_audit_log_no_update blocks every UPDATE on this table. So the cascade could
-- never fire: deleting a bond or a user failed with "bond_audit_log is append-only:
-- UPDATE is not permitted" — a trigger error that says nothing about the foreign key
-- actually responsible. RESTRICT produces an honest constraint violation instead.
--
-- This changes no capability. Nothing in the application deletes a bond or a user
-- (there is no such route or call), and both were already undeletable in practice.
-- It only changes which error a future caller gets, and makes the permanence of
-- anything with audit history explicit in the schema.

-- DropForeignKey
ALTER TABLE "bond_audit_log" DROP CONSTRAINT "bond_audit_log_bond_id_fkey";

-- DropForeignKey
ALTER TABLE "bond_audit_log" DROP CONSTRAINT "bond_audit_log_user_id_fkey";

-- AddForeignKey
ALTER TABLE "bond_audit_log" ADD CONSTRAINT "bond_audit_log_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_audit_log" ADD CONSTRAINT "bond_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
