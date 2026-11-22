import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ACCOUNT_SESSION_SECONDS = 30 * 24 * 60 * 60;
type Account = { id: string; email: string };
type Credentials = Account & { passwordHash: string };
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function withDatabase<T>(work: (db: DatabaseSync) => T): T {
  const root = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".local-data");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, "accounts.sqlite");
  closeSync(openSync(file, "a", 0o600));
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id);
      CREATE TABLE IF NOT EXISTS account_chat_onboarding (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE
      );
    `);
    return work(db);
  } finally {
    db.close();
  }
}

function insertSession(db: DatabaseSync, ownerId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("DELETE FROM account_sessions WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO account_sessions VALUES (?, ?, ?)").run(tokenHash(token), ownerId, now + ACCOUNT_SESSION_SECONDS * 1000);
  return token;
}

export function registerAccount(email: string, passwordHash: string): string | null {
  return withDatabase(db => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const id = `account-${randomUUID()}`;
      const result = db.prepare("INSERT INTO accounts VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING").run(id, email, passwordHash);
      const token = result.changes ? insertSession(db, id) : null;
      db.exec("COMMIT");
      return token;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

export function findAccountCredentials(email: string): Credentials | null {
  return withDatabase(db => db.prepare("SELECT id, email, password_hash AS passwordHash FROM accounts WHERE email = ?").get(email) as Credentials | undefined ?? null);
}

export function createAccountSession(ownerId: string): string {
  return withDatabase(db => insertSession(db, ownerId));
}

export function findSessionAccount(token: string): Account | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return withDatabase(db => db.prepare(`
    SELECT accounts.id, accounts.email FROM account_sessions
    JOIN accounts ON accounts.id = account_sessions.account_id
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash(token), Date.now()) as Account | undefined ?? null);
}

export function revokeAccountSession(token: string): void {
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
    withDatabase(db => db.prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(tokenHash(token)));
  }
}

/** Only one opening per account can show the guided introduction. */
export function claimFirstChatOnboarding(ownerId: string): boolean {
  return withDatabase(db => Boolean(
    db.prepare("INSERT INTO account_chat_onboarding (account_id) VALUES (?) ON CONFLICT(account_id) DO NOTHING").run(ownerId).changes,
  ));
}

export function deleteAccountIdentity(ownerId: string): void {
  withDatabase(db => db.prepare("DELETE FROM accounts WHERE id = ?").run(ownerId));
}
