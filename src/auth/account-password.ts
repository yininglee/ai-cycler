import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const digestBytes = 64;
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, digestBytes, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashAccountPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyAccountPassword(password: string, hash?: string): Promise<boolean> {
  // Run the same work for an unknown email to avoid a fast failure path.
  const [salt, digest] = hash?.split(":") ?? [];
  const expected = digest ? Buffer.from(digest, "hex") : Buffer.alloc(digestBytes);
  const candidate = await derive(password, salt ? Buffer.from(salt, "hex") : Buffer.alloc(16));
  return expected.length === candidate.length && timingSafeEqual(expected, candidate) && Boolean(hash);
}
