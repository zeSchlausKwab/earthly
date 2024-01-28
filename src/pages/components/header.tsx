import { Button } from "~/components/ui/button";
import React, { ChangeEvent, useState } from "react";
import { NDKNip07Signer } from "@nostr-dev-kit/ndk";
import { useNDKStore } from "~/store/ndk-store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Input } from "~/components/ui/input";
import { generatePrivateKey, getPublicKey } from "nostr-tools";
import { Separator } from "~/components/ui/separator";
import { ClipboardCopy } from "lucide-react";
import { useToast } from "~/components/ui/use-toast";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { UserInfo } from "~/pages/components/user-info";

const privateKeySchema = z.object({
  privateKey: z
    .string()
    .min(64, "Private key should be at least 64 characters long"),
});

export const Header = () => {
  const { ndk, initPrivateKey, initSigner } = useNDKStore();

  const { toast } = useToast();

  const [keyPair, setKeyPair] = useState<{
    publicKey: string;
    privateKey: string;
  }>({
    publicKey: "",
    privateKey: "",
  });
  const form = useForm<z.infer<typeof privateKeySchema>>({
    resolver: zodResolver(privateKeySchema),
    defaultValues: {
      privateKey: "",
    },
  });
  const onAuthenticateWithSigner = async () => {
    const nip07signer = new NDKNip07Signer();
    await initSigner(nip07signer);

    nip07signer.user().then(async (user) => {
      if (!!user.npub && ndk) {
        const test = ndk.getUser({
          npub: user.npub,
        });

        setKeyPair({
          publicKey: user.npub,
          privateKey: "",
        });

        const resolvedUser = await test.fetchProfile();

        console.log("Permission granted to read their public key:", user.npub);
        console.log("User profile:", resolvedUser);

        toast({
          title: "Successfully authenticated with signer",
          description: `You are now authenticated with your signer.`,
        });
      }
    });
  };

  const onAuthenticateWithPrivateKey = async () => {
    await initPrivateKey(keyPair.privateKey);
    toast({
      title: "Successfully authenticated with private key",
      description: "You are now authenticated with your private key.",
    });
  };

  const onGenerateKeyPair = async () => {
    const generatedPrivateKey = generatePrivateKey();
    const publicKey = getPublicKey(generatedPrivateKey);
    setKeyPair({
      publicKey,
      privateKey: generatedPrivateKey,
    });
    form.setValue("privateKey", generatedPrivateKey);
    await form.trigger("privateKey");
  };

  const onPrivateKeyInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const privateKey = e.target.value;
    form.setValue("privateKey", privateKey);
    const formState = await form.trigger("privateKey");

    if (formState) {
      setKeyPair({
        publicKey: getPublicKey(privateKey),
        privateKey: privateKey,
      });
    } else {
      setKeyPair({
        publicKey: "",
        privateKey: "",
      });
    }
  };

  const handleCopyPrivateKeyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(keyPair.privateKey);
      toast({
        title: "Private key copied to clipboard",
        description: "Preserve this key in a safe place.",
      });
    } catch (err) {
      toast({
        title: "Failed to copy text",
        description: "Error: " + JSON.stringify(err),
      });
    }
  };

  return (
    <header className="flex flex-none flex-row items-center justify-between bg-gray-200 p-4">
      <h1 className="text-2xl font-bold">earthly</h1>
      <div className="z-50 flex flex-row gap-8 text-xs">
        <UserInfo />
        <Popover>
          <PopoverTrigger asChild>
            <Button>Authenticate</Button>
          </PopoverTrigger>
          <PopoverContent className="break-all">
            <div className="flex flex-col gap-4">
              <Button onClick={onAuthenticateWithSigner}>
                Authenticate with signer
              </Button>
              <Button
                className={"flex-grow"}
                disabled={!Boolean(keyPair.privateKey)}
                onClick={onAuthenticateWithPrivateKey}
              >
                Authenticate with private key
              </Button>
              <Separator orientation={"horizontal"} />
              <Button onClick={onGenerateKeyPair}>
                Generate new private key
              </Button>
              <div className={"flex flex-row"}>
                <Form {...form}>
                  <form className="flex-grow">
                    <FormField
                      control={form.control}
                      name="privateKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Private Key</FormLabel>
                          <FormControl>
                            <div className={"flex flex-row items-center gap-2"}>
                              <Input
                                placeholder="...private key"
                                {...field}
                                onChange={onPrivateKeyInput}
                              />
                              <ClipboardCopy
                                onClick={handleCopyPrivateKeyToClipboard}
                              />
                            </div>
                          </FormControl>
                          {form.formState.errors.privateKey && (
                            <FormMessage>
                              {form.formState.errors.privateKey.message}
                            </FormMessage>
                          )}
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </div>
              <div className={"p-2 text-xs"}>
                {keyPair.publicKey ? (
                  <p>{keyPair.publicKey}</p>
                ) : (
                  <p>No private key set.</p>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
};
