import crypto from "crypto"
import { Buffer } from "buffer"

function create32ByteBuffer(inputString: string) {
  const hash = crypto.createHash("sha256").update(inputString).digest("hex")
  const buffer = Buffer.from(hash, "hex")
  return buffer
}

export function encryptMessage(message: string, password: string) {
  try {
    const buffer = create32ByteBuffer(password)
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv("aes-256-cbc", buffer, iv)

    const encrypted = Buffer.concat([
      cipher.update(message, "utf-8"),
      cipher.final(),
    ])

    return encrypted.toString("base64") + "?iv=" + iv.toString("base64")
  } catch (e) {
    console.error(e)
  }
}
// Function to decrypt a hashed message using a passphrase
// Function to decrypt a hashed message using a passphrase
export function decryptMessage(encryptedMessage: string, password: string) {
  try {
    const buffer = create32ByteBuffer(password)
    // Extract IV from the received message
    const [message, ivBase64] = encryptedMessage.split("?iv=")
    if (!message || !ivBase64) {
      return
    }

    const iv = Buffer.from(ivBase64, "base64")
    const encryptedText = Buffer.from(message, "base64")
    const decipher = crypto.createDecipheriv("aes-256-cbc", buffer, iv)
    const decrypted = decipher.update(encryptedText)
    return Buffer.concat([decrypted, decipher.final()]).toString()
  } catch (e) {
    console.error("Error decrypting", e)
  }
}
