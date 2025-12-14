import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { useState, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import {
  Copy,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  QrCode,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Scanner } from "@yudiel/react-qr-scanner";

interface SignupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (signer: any) => Promise<void>;
}

type Mode = "create" | "import";

export function SignupDialog({
  open,
  onOpenChange,
  onConfirm,
}: SignupDialogProps) {
  const [mode, setMode] = useState<Mode>("create");
  const [signer] = useState(() => NDKPrivateKeySigner.generate());
  const [nsecCopied, setNsecCopied] = useState(false);
  const [npubCopied, setNpubCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nsec, setNsec] = useState("");
  const [npub, setNpub] = useState("");
  const [importKey, setImportKey] = useState("");
  const [importError, setImportError] = useState("");
  const [isImportCollapsed, setIsImportCollapsed] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Generate nsec and npub when dialog opens
  useEffect(() => {
    if (open && signer) {
      // Get the hex private key
      const privateKeyHex = signer.privateKey;
      if (privateKeyHex) {
        // Convert hex to Uint8Array for encoding
        const privateKeyBytes = new Uint8Array(
          privateKeyHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ||
            []
        );
        setNsec(nip19.nsecEncode(privateKeyBytes));
      }

      // Get public key
      signer.user().then((user) => {
        if (user.pubkey) {
          setNpub(nip19.npubEncode(user.pubkey));
        }
      });
    }
  }, [open, signer]);

  const handleCopyNsec = async () => {
    await navigator.clipboard.writeText(nsec);
    setNsecCopied(true);
    setTimeout(() => setNsecCopied(false), 2000);
  };

  const handleCopyNpub = async () => {
    await navigator.clipboard.writeText(npub);
    setNpubCopied(true);
    setTimeout(() => setNpubCopied(false), 2000);
  };

  const parsePrivateKey = (input: string): string | null => {
    const trimmed = input.trim();

    // Try to decode nsec
    if (trimmed.startsWith("nsec1")) {
      try {
        const { type, data } = nip19.decode(trimmed);
        if (type === "nsec") {
          // Convert Uint8Array to hex string
          return Array.from(data as Uint8Array)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
      } catch (e) {
        return null;
      }
    }

    // Try as hex key (64 characters)
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    return null;
  };

  const handleImportKeyChange = (value: string) => {
    setImportKey(value);
    setImportError("");

    if (value.trim()) {
      const parsed = parsePrivateKey(value);
      if (!parsed) {
        setImportError(
          "Invalid private key. Please enter a valid nsec or hex private key."
        );
      }
    }
  };

  const handleConfirm = async () => {
    try {
      setLoading(true);

      let signerToUse = signer;

      if (mode === "import") {
        const privateKeyHex = parsePrivateKey(importKey);
        if (!privateKeyHex) {
          setImportError(
            "Invalid private key. Please enter a valid nsec or hex private key."
          );
          setLoading(false);
          return;
        }
        signerToUse = new NDKPrivateKeySigner(privateKeyHex);
      }

      await onConfirm(signerToUse);
      onOpenChange(false);

      // Reset state
      setMode("create");
      setImportKey("");
      setImportError("");
    } catch (error) {
      console.error("Signup/Login failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleScanQR = () => {
    setShowScanner(true);
    setScanError(null);
  };

  const handleScan = useCallback((detectedCodes: any[]) => {
    if (detectedCodes && detectedCodes.length > 0) {
      const result = detectedCodes[0].rawValue;
      if (result) {
        // Try to parse the scanned result
        const parsed = parsePrivateKey(result);
        if (parsed) {
          setImportKey(result);
          setImportError("");
          setShowScanner(false);
          setScanError(null);
        } else {
          setScanError(
            "The scanned QR code does not contain a valid private key (nsec or hex format)"
          );
        }
      }
    }
  }, []);

  const handleScanError = useCallback((err: any) => {
    console.error(err);
    setScanError("Error accessing camera: " + (err.message || "Unknown error"));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "Create Your Nostr Account"
              : "Login with Private Key"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Your account has been generated. Please save your private key (nsec) securely."
              : "Enter your existing private key (nsec or hex) to login."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="flex gap-2 p-1 bg-muted rounded-lg">
            <Button
              variant={mode === "create" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("create")}
              disabled={loading}
            >
              Create New Account
            </Button>
            <Button
              variant={mode === "import" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("import")}
              disabled={loading}
            >
              Import Existing Key
            </Button>
          </div>

          {mode === "create" ? (
            <>
              {/* Warning Alert */}
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Important: Save Your Private Key</AlertTitle>
                <AlertDescription>
                  Your private key (nsec) is the only way to access your
                  account. If you lose it, you will lose access to your account
                  forever. There is no way to recover it. Store it somewhere
                  safe, like a password manager.
                </AlertDescription>
              </Alert>

              {/* Private Key (nsec) */}
              <div className="space-y-2">
                <Label htmlFor="nsec">Private Key (nsec)</Label>
                <div className="flex gap-2">
                  <div className="flex-1 p-3 bg-destructive/10 border border-destructive/30 rounded-md font-mono text-sm break-all">
                    {nsec}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyNsec}
                    className="flex-shrink-0"
                  >
                    {nsecCopied ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Keep this private! Never share your nsec with anyone.
                </p>
              </div>

              {/* Public Key (npub) */}
              <div className="space-y-2">
                <Label htmlFor="npub">Public Key (npub)</Label>
                <div className="flex gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
                    {npub}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyNpub}
                    className="flex-shrink-0"
                  >
                    {npubCopied ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This is your public identifier. You can share this with
                  others.
                </p>
              </div>

              {/* Additional Info */}
              <div className="rounded-lg bg-muted p-4 space-y-2">
                <h4 className="font-semibold text-sm">What's next?</h4>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Copy and save your private key (nsec) in a safe place</li>
                  <li>You can import this key into other Nostr clients</li>
                  <li>Use your public key (npub) to let others find you</li>
                  <li>Set up your profile in the settings after logging in</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* Import Warning with Collapsible */}
              <Collapsible
                open={isImportCollapsed}
                onOpenChange={setIsImportCollapsed}
                className="border-2 border-destructive rounded-lg p-4 bg-destructive/5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="font-semibold text-destructive">
                        ⚠️ Security Warning
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Only enter your private key on trusted devices and
                        applications. Never share your private key with anyone.
                        Anyone with access to your private key can control your
                        account.
                      </p>
                    </div>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0 hover:bg-destructive/20"
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          isImportCollapsed ? "rotate-180" : ""
                        }`}
                      />
                      <span className="sr-only">Toggle input</span>
                    </Button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent className="mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="import-key" className="text-base">
                      Private Key (nsec or hex format)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="import-key"
                        type="password"
                        placeholder="nsec1... or hex private key"
                        value={importKey}
                        onChange={(e) => handleImportKeyChange(e.target.value)}
                        className={`flex-1 h-12 text-base font-mono ${
                          importError ? "border-destructive" : ""
                        }`}
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleScanQR}
                        disabled={loading}
                        title="Scan QR code"
                        className="h-12 w-12 flex-shrink-0"
                      >
                        <QrCode className="h-5 w-5" />
                      </Button>
                    </div>
                    {importError && (
                      <p className="text-xs text-destructive">{importError}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Your key is never sent to any server and stays on your
                      device.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Info about import */}
              {!isImportCollapsed && (
                <div className="rounded-lg bg-muted p-4 space-y-2">
                  <h4 className="font-semibold text-sm">
                    How to import your key:
                  </h4>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Click the chevron icon in the red warning box above</li>
                    <li>
                      Enter your private key (starts with "nsec1" or
                      64-character hex)
                    </li>
                    <li>Click "Login" to access your account</li>
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              loading || (mode === "import" && (!importKey || !!importError))
            }
          >
            {loading
              ? mode === "create"
                ? "Creating Account..."
                : "Logging in..."
              : mode === "create"
              ? "I've Saved My Key, Continue"
              : "Login"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* QR Scanner Dialog */}
      <Dialog open={showScanner} onOpenChange={setShowScanner}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan Private Key QR Code</DialogTitle>
            <DialogDescription>
              Scan a QR code containing your private key (nsec or hex format)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {scanError ? (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{scanError}</AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  onClick={() => setScanError(null)}
                  className="w-full"
                >
                  Try Again
                </Button>
              </div>
            ) : (
              <div className="relative w-full aspect-square overflow-hidden rounded-lg">
                <Scanner
                  onScan={handleScan}
                  onError={handleScanError}
                  constraints={{
                    facingMode: "environment",
                  }}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowScanner(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
