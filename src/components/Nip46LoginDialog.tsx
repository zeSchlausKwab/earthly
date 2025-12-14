import { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import NDK, {
  NDKEvent,
  NDKKind,
  NDKNip46Signer,
  NDKPrivateKeySigner,
} from "@nostr-dev-kit/react";
import { Scanner } from "@yudiel/react-qr-scanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Loader2, QrCode } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Nip46LoginDialogProps {
  trigger: React.ReactNode;
  onLogin: (signer: NDKNip46Signer) => Promise<void>;
}

type TabType = "scan" | "paste";

// Common NIP-46 relays
const DEFAULT_RELAYS = [
  { value: "wss://relay.nsec.app", label: "relay.nsec.app (recommended)" },
  { value: "wss://relay.damus.io", label: "relay.damus.io" },
  { value: "wss://nos.lol", label: "nos.lol" },
  { value: "wss://relay.primal.net", label: "relay.primal.net" },
  { value: "wss://relay.wavefunc.live", label: "relay.wavefunc.live" },
];

type ConnectionState =
  | "idle"
  | "generating"
  | "waiting"
  | "connected"
  | "error";

export function Nip46LoginDialog({ trigger, onLogin }: Nip46LoginDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("scan");

  // Simplified state management
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedRelay, setSelectedRelay] = useState(DEFAULT_RELAYS[0].value);

  // Scan tab state
  const [connectionUri, setConnectionUri] = useState("");
  const [localSigner, setLocalSigner] = useState<NDKPrivateKeySigner | null>(
    null
  );

  // Paste tab state
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Refs for cleanup
  const ndkRef = useRef<NDK | null>(null);
  const subscriptionRef = useRef<any>(null);
  const secretRef = useRef<string>("");
  const isProcessingRef = useRef(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    isProcessingRef.current = false;

    if (subscriptionRef.current) {
      try {
        subscriptionRef.current.stop();
      } catch (e) {
        console.error("Error stopping subscription:", e);
      }
      subscriptionRef.current = null;
    }

    if (ndkRef.current) {
      ndkRef.current = null;
    }
  }, []);

  // Reset all state when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      cleanup();
      setState("idle");
      setError(null);
      setConnectionUri("");
      setLocalSigner(null);
      setBunkerUrl("");
      setShowScanner(false);
      setScanError(null);
      secretRef.current = "";
    }
  };

  // Reset connection when relay changes
  const handleRelayChange = (relay: string) => {
    setSelectedRelay(relay);
    if (activeTab === "scan" && connectionUri) {
      // Reset connection to regenerate with new relay
      cleanup();
      setConnectionUri("");
      setState("idle");
      setError(null);
    }
  };

  // Initialize connection for scan tab
  useEffect(() => {
    if (!open || activeTab !== "scan" || connectionUri) return;

    const initConnection = async () => {
      setState("generating");
      setError(null);

      try {
        // Generate local keypair
        const signer = NDKPrivateKeySigner.generate();
        const user = await signer.user();
        secretRef.current = Math.random().toString(36).substring(2, 15);

        // Build nostrconnect URI
        const params = new URLSearchParams({
          relay: selectedRelay,
          metadata: JSON.stringify({
            name: "Earthly City",
            description: "Connect with Earthly City",
            url: window.location.origin,
          }),
          token: secretRef.current,
        });

        const uri = `nostrconnect://${user.pubkey}?${params.toString()}`;

        setLocalSigner(signer);
        setConnectionUri(uri);
        setState("waiting");

        // Start listening for connection
        await startListening(signer, user.pubkey, selectedRelay);
      } catch (err) {
        console.error("Failed to initialize connection:", err);
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to initialize");
      }
    };

    initConnection();
  }, [open, activeTab, connectionUri, selectedRelay]);

  // Listen for NIP-46 connection requests
  const startListening = async (
    signer: NDKPrivateKeySigner,
    pubkey: string,
    relay: string
  ) => {
    cleanup(); // Clean up any existing connection

    const ndk = new NDK({ explicitRelayUrls: [relay] });
    ndkRef.current = ndk;

    try {
      await ndk.connect();
    } catch (error) {
      console.error("Failed to connect to relay:", error);
      setState("error");
      setError(`Failed to connect to ${relay}`);
      return;
    }

    const processedIds = new Set<string>();

    const sub = ndk.subscribe(
      { kinds: [NDKKind.NostrConnect], "#p": [pubkey] },
      { closeOnEose: false }
    );

    subscriptionRef.current = sub;

    sub.on("event", async (event: NDKEvent) => {
      if (isProcessingRef.current || processedIds.has(event.id)) return;

      try {
        await event.decrypt(undefined, signer);
        const request = JSON.parse(event.content);

        // Handle connect request
        if (
          request.method === "connect" &&
          request.params?.token === secretRef.current
        ) {
          if (request.id) processedIds.add(request.id);

          // Send approval
          const response = new NDKEvent(ndk);
          response.kind = NDKKind.NostrConnect;
          response.tags = [["p", event.pubkey]];
          response.content = JSON.stringify({
            id: request.id,
            result: secretRef.current,
          });

          await response.sign(signer);
          // @ts-ignore - NDK type mismatch
          await response.encrypt(undefined, signer, event.pubkey);
          await response.publish();
        }
        // Handle ack - connection successful
        else if (request.result === "ack") {
          if (processedIds.has(event.id)) return;
          processedIds.add(event.id);

          isProcessingRef.current = true;
          setState("connected");

          // Build bunker URL and create signer
          const bunkerUrl = `bunker://${event.pubkey}?relay=${relay}&secret=${secretRef.current}`;

          const loginNdk = new NDK({ explicitRelayUrls: [relay] });
          await loginNdk.connect();

          const nip46Signer = NDKNip46Signer.bunker(
            loginNdk,
            bunkerUrl,
            signer
          );
          await nip46Signer.blockUntilReady();

          await onLogin(nip46Signer);

          cleanup();
          setOpen(false);
        }
      } catch (error) {
        console.error("Failed to process NIP-46 event:", error);
        setState("error");
        setError(error instanceof Error ? error.message : "Connection failed");
        isProcessingRef.current = false;
      }
    });

    // 5 minute timeout
    setTimeout(() => {
      if (state === "waiting") {
        cleanup();
        setState("error");
        setError("Connection timed out. Please try again.");
      }
    }, 300000);
  };

  // Handle paste tab login
  const handlePasteLogin = async () => {
    if (!bunkerUrl.trim()) {
      setError("Please enter a bunker URL");
      return;
    }

    setState("generating");
    setError(null);

    try {
      // Extract relay from bunker URL or use selected relay
      const url = new URL(bunkerUrl);
      const relayParam = url.searchParams.get("relay");
      const relay = relayParam || selectedRelay;

      // Create local signer if needed
      let signer = localSigner;
      if (!signer) {
        signer = NDKPrivateKeySigner.generate();
        setLocalSigner(signer);
      }

      const ndk = new NDK({ explicitRelayUrls: [relay] });
      await ndk.connect();

      const nip46Signer = NDKNip46Signer.bunker(ndk, bunkerUrl, signer);
      await nip46Signer.blockUntilReady();

      await onLogin(nip46Signer);
      setOpen(false);
    } catch (err: any) {
      console.error("NIP-46 login failed:", err);
      setState("error");
      setError(err.message || "Failed to connect with bunker URL");
    }
  };

  // QR Scanner handlers
  const handleScanQR = () => {
    setShowScanner(true);
    setScanError(null);
  };

  const handleScan = useCallback((detectedCodes: any[]) => {
    if (detectedCodes && detectedCodes.length > 0) {
      const result = detectedCodes[0].rawValue;
      if (result && result.startsWith("bunker://")) {
        setBunkerUrl(result);
        setError(null);
        setShowScanner(false);
      } else if (result) {
        setScanError("The scanned code is not a valid bunker:// URI");
      }
    }
  }, []);

  const handleScanError = useCallback((err: any) => {
    console.error(err);
    setScanError("Error accessing camera: " + (err.message || "Unknown error"));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect with Remote Signer</DialogTitle>
          <DialogDescription>
            Use a remote signer app like Amber or nsecBunker
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Relay Selection */}
          <div className="space-y-2">
            <Label htmlFor="relay">NIP-46 Relay</Label>
            <Select value={selectedRelay} onValueChange={handleRelayChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_RELAYS.map((relay) => (
                  <SelectItem key={relay.value} value={relay.value}>
                    {relay.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose the relay for NIP-46 connection. Your remote signer should
              use the same relay.
            </p>
          </div>

          {/* Tab Buttons */}
          <div className="flex gap-2 border-b border-brutal">
            <button
              onClick={() => setActiveTab("scan")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "scan"
                  ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              Scan QR Code
            </button>
            <button
              onClick={() => setActiveTab("paste")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "paste"
                  ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              Paste Bunker URL
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === "scan" ? (
            <div className="space-y-4">
              {state === "connected" ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <div className="text-green-500 mb-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <p className="text-sm text-green-500 font-medium">
                    Connected successfully!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Logging you in...
                  </p>
                </div>
              ) : state === "generating" ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Generating connection...
                  </p>
                </div>
              ) : connectionUri ? (
                <>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Scan this QR code with your remote signer app (e.g., Amber)
                  </div>

                  <a
                    href={connectionUri}
                    className="block hover:opacity-90 transition-opacity bg-white p-4 rounded-lg"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <QRCodeSVG
                      value={connectionUri}
                      size={250}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      level="L"
                    />
                  </a>

                  {state === "waiting" && (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Waiting for approval...</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Input
                      value={connectionUri}
                      readOnly
                      onClick={(e) => e.currentTarget.select()}
                      className="font-mono text-xs"
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Initializing connection...
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bunker-url">Bunker URL</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Paste your bunker:// connection string from your remote signer
                  (e.g., nsec.app, Amber).
                </p>
                <div className="flex gap-2">
                  <Input
                    id="bunker-url"
                    type="text"
                    placeholder="bunker://..."
                    value={bunkerUrl}
                    onChange={(e) => {
                      setBunkerUrl(e.target.value);
                      setError(null);
                    }}
                    disabled={state === "generating"}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleScanQR}
                    disabled={state === "generating"}
                    title="Scan QR code"
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Button
                onClick={handlePasteLogin}
                disabled={state === "generating" || !bunkerUrl.trim()}
                className="w-full"
              >
                {state === "generating" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>

              <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <h4 className="text-sm font-medium mb-2">
                  How to get a bunker URL:
                </h4>
                <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Open your remote signer app (nsec.app, Amber, etc.)</li>
                  <li>Generate or copy your bunker connection string</li>
                  <li>Paste it into the field above or scan the QR code</li>
                </ol>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 p-3 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}
        </div>
      </DialogContent>

      {/* QR Scanner Dialog */}
      <Dialog open={showScanner} onOpenChange={setShowScanner}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan Bunker QR Code</DialogTitle>
            <DialogDescription>
              Scan a bunker:// connection QR code from your remote signer
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 mb-4">
            {scanError ? (
              <div className="p-4 mb-4 text-sm text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/20 rounded-lg">
                {scanError}
                <Button
                  onClick={() => setScanError(null)}
                  variant="outline"
                  size="sm"
                  className="ml-2 mt-2"
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
