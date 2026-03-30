import * as crypto from "crypto";

/**
 * Génère un code_verifier aléatoire (43 caractères, alphanumérique + -._~)
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url").slice(0, 43);
}

/**
 * Calcule le code_challenge = Base64URL(SHA-256(verifier))
 * Méthode S256 requise par Beacon API v4
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
