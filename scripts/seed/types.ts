import type { NDKPrivateKeySigner } from "@/lib/ndk-shim";

export type BoundingBox = [number, number, number, number];

export interface SeedIdentity {
	label: string;
	signer: NDKPrivateKeySigner;
	pubkey: string;
}

export interface CommentTarget {
	id: string | null;
	kind: number;
	dTag: string;
	name: string;
	ownerPubkey: string;
	bbox?: BoundingBox;
}
