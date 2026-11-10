import { randomUUID } from "node:crypto";
import { db } from "./db";

export async function auditLog(action: string, detail: object = {}) {
  await db.query(
    "INSERT INTO admin_audit(id,action,detail) VALUES($1,$2,$3)",
    [randomUUID(), action, JSON.stringify(detail)],
  );
}
export async function recentAudit(limit = 100) {
  const { rows } = await db.query(
    "SELECT id,action,detail,created_at FROM admin_audit ORDER BY created_at DESC LIMIT $1",
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows;
}
