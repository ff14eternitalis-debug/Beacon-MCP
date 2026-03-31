/**
 * Client TCP pour le Beacon Connector.
 *
 * Protocole (extrait du code source Xojo du Connector) :
 *
 * 1. Client se connecte sur le port (défaut 48962)
 * 2. Serveur envoie un message chiffré avec la clé pré-partagée :
 *    { "Key": "<hex 64 chars>" }  →  clé de connexion 32 bytes
 * 3. Client déchiffre, extrait la connectionKey
 * 4. Échange : chaque message est chiffré avec la connectionKey
 *    et inclut un nonce séquentiel (commence à 1)
 *
 * Format d'un message chiffré (26 bytes header + payload chiffré) :
 *   Offset  Size  Description
 *   0       1     Magic byte : 0x8A
 *   1       1     Version : 2 (AES-256-CBC)
 *   2       16    IV aléatoire
 *   18      4     UInt32 BE — longueur du payload clair
 *   22      4     UInt32 BE — CRC32 du payload clair
 *   26      N     Payload chiffré AES-256-CBC (PKCS7, aligné 16 bytes)
 */

import * as net from "net";
import * as crypto from "crypto";

const MAGIC_BYTE = 0x8a;
const VERSION_AES = 2;
const IV_SIZE = 16;
const HEADER_SIZE = 2 + IV_SIZE + 4 + 4; // = 26 bytes
const DEFAULT_PORT = 48962;
const CONNECT_TIMEOUT_MS = 10_000;

export interface ConnectorConfig {
  host: string;
  port?: number;
  /** Clé pré-partagée : hex 64 caractères (32 bytes) ou chaîne quelconque (hashée en SHA-256). */
  key: string;
}

// ---------------------------------------------------------------------------
// Utilitaires crypto
// ---------------------------------------------------------------------------

/**
 * Prépare la clé pré-partagée selon la même logique que le Connector Xojo :
 * - Si hex 64 caractères → décode directement en 32 bytes
 * - Sinon → hash SHA-256 de la chaîne
 */
function prepareKey(keyInput: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(keyInput)) {
    return Buffer.from(keyInput, "hex");
  }
  return crypto.createHash("sha256").update(keyInput).digest();
}

/**
 * CRC32 polynomial 0xEDB88320 — implémentation identique au Connector Xojo.
 */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    let t = ((crc & 0xff) ^ data[i]) >>> 0;
    for (let b = 0; b < 8; b++) {
      t = t & 1 ? ((t >>> 1) ^ 0xedb88320) >>> 0 : (t >>> 1) >>> 0;
    }
    crc = ((crc >>> 8) ^ t) >>> 0;
  }
  return ((crc ^ 0xffffffff) >>> 0);
}

/**
 * Longueur du payload chiffré pour un payload clair de `n` bytes (PKCS7).
 * Correspond exactement à EncryptedLength() dans SymmetricHeader.xojo_code.
 */
function encryptedLength(n: number): number {
  const blockSize = 16;
  let blocks = Math.ceil(n / blockSize);
  if (n % blockSize === 0) blocks += 1; // bloc de padding complet si multiple exact
  return blocks * blockSize;
}

/**
 * Longueur totale du message (header + payload chiffré) d'après les premiers bytes du buffer.
 * Retourne 0 si le buffer est trop court pour lire le header.
 */
function messageLength(buffer: Buffer): number {
  if (buffer.length < HEADER_SIZE) return 0;
  if (buffer[0] !== MAGIC_BYTE) throw new Error(`Magic byte invalide : 0x${buffer[0].toString(16)}`);
  if (buffer[1] !== VERSION_AES) throw new Error(`Version non supportée : ${buffer[1]}`);
  const payloadLen = buffer.readUInt32BE(2 + IV_SIZE); // offset 18
  return HEADER_SIZE + encryptedLength(payloadLen);
}

// ---------------------------------------------------------------------------
// Chiffrement / déchiffrement
// ---------------------------------------------------------------------------

function encryptMessage(key: Buffer, plaintext: string): Buffer {
  const data = Buffer.from(plaintext, "utf8");
  const iv = crypto.randomBytes(IV_SIZE);
  const checksum = crc32(data);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header[0] = MAGIC_BYTE;
  header[1] = VERSION_AES;
  iv.copy(header, 2);
  header.writeUInt32BE(data.length, 2 + IV_SIZE);      // offset 18
  header.writeUInt32BE(checksum, 2 + IV_SIZE + 4);     // offset 22

  return Buffer.concat([header, encrypted]);
}

function decryptMessage(key: Buffer, data: Buffer): string {
  if (data.length < HEADER_SIZE) throw new Error("Message trop court");
  if (data[0] !== MAGIC_BYTE) throw new Error(`Magic byte invalide : 0x${data[0].toString(16)}`);
  if (data[1] !== VERSION_AES) throw new Error(`Version non supportée : ${data[1]}`);

  const iv = data.slice(2, 2 + IV_SIZE);
  const expectedLen = data.readUInt32BE(2 + IV_SIZE);
  const expectedCrc = data.readUInt32BE(2 + IV_SIZE + 4);
  const encryptedData = data.slice(HEADER_SIZE);

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

  // Sécurité : trim au cas où PKCS7 laisserait des bytes excédentaires
  if (decrypted.length > expectedLen) {
    decrypted = decrypted.subarray(0, expectedLen);
  }

  const actualCrc = crc32(decrypted);
  if (actualCrc !== expectedCrc) {
    throw new Error(`CRC32 invalide : attendu ${expectedCrc}, calculé ${actualCrc}`);
  }

  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// Interface publique
// ---------------------------------------------------------------------------

export type ConnectorResponse = Record<string, unknown>;

/**
 * Ouvre une connexion TCP vers le Connector, effectue le handshake,
 * envoie la commande et retourne la réponse JSON.
 * La connexion est fermée après chaque appel.
 */
export async function sendConnectorCommand(
  config: ConnectorConfig,
  command: string,
  extra?: Record<string, unknown>
): Promise<ConnectorResponse> {
  const preSharedKey = prepareKey(config.key);
  const port = config.port ?? DEFAULT_PORT;

  return new Promise<ConnectorResponse>((resolve, reject) => {
    const socket = new net.Socket();
    let receiveBuffer = Buffer.alloc(0);
    let connectionKey: Buffer | null = null;
    let resolved = false;
    let nonce = 1;

    const fail = (err: Error): void => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      reject(err);
    };

    const succeed = (result: ConnectorResponse): void => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      fail(new Error(`Timeout — aucune réponse du Connector sous ${CONNECT_TIMEOUT_MS / 1000}s`));
    }, CONNECT_TIMEOUT_MS);

    socket.connect(port, config.host);

    socket.on("data", (chunk: Buffer) => {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

      // Traite tous les messages complets dans le buffer
      while (receiveBuffer.length >= HEADER_SIZE) {
        let msgLen: number;
        try {
          msgLen = messageLength(receiveBuffer);
        } catch (e) {
          clearTimeout(timer);
          fail(e instanceof Error ? e : new Error(String(e)));
          return;
        }

        if (msgLen === 0 || receiveBuffer.length < msgLen) break;

        const msgData = receiveBuffer.subarray(0, msgLen);
        receiveBuffer = receiveBuffer.subarray(msgLen);

        try {
          if (connectionKey === null) {
            // Phase handshake : déchiffrer avec la clé pré-partagée
            const json = decryptMessage(preSharedKey, msgData);
            const parsed = JSON.parse(json) as Record<string, unknown>;
            const hexKey = parsed["Key"] as string | undefined;
            if (!hexKey || hexKey.length !== 64) {
              throw new Error(`Clé de connexion invalide reçue : "${hexKey}"`);
            }
            connectionKey = Buffer.from(hexKey, "hex");

            // Envoie la commande avec le nonce 1
            const payload = JSON.stringify({ Nonce: nonce, Command: command, ...extra });
            socket.write(encryptMessage(connectionKey, payload));

          } else {
            // Phase réponse : déchiffrer avec la clé de connexion
            const json = decryptMessage(connectionKey, msgData);
            const result = JSON.parse(json) as ConnectorResponse;
            clearTimeout(timer);
            succeed(result);
          }
        } catch (e) {
          clearTimeout(timer);
          fail(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      fail(new Error(`Erreur TCP : ${err.message}`));
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!resolved) {
        fail(new Error("Connexion fermée par le serveur avant la réponse"));
      }
    });
  });
}
