// seed.ts

import NDK, { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { config } from "dotenv";
import { devUser1 } from "@/lib/fixtures";
import { createGeoEventEvent, generateGeoEventData } from "./gen_geo_events";
import { createUserProfileEvent, generateUserProfileData } from "./gen_user";

config();

const ndk = new NDK({
	explicitRelayUrls: ["ws://localhost:3334"],
	enableOutboxModel: false,
});

const devUsers = [devUser1];

async function seedData() {
	console.log("[Seed] Connecting to Nostr...");
	await ndk.connect();

	console.log("Starting seeding...");

	// Seed a single deterministic user with real East German datasets only
	const user = devUsers[0];
	const signer = new NDKPrivateKeySigner(user.sk);
	await signer.blockUntilReady();
	const pubkey = (await signer.user()).pubkey;

	console.log(`Creating profile for user ${pubkey.substring(0, 8)}...`);
	const userProfile = generateUserProfileData(0);
	await createUserProfileEvent(signer, ndk, userProfile);

	console.log("Creating real-world datasets: East German Bundesländer...");
	const eastGermanStates = [
		"Mecklenburg-Vorpommern",
		"Brandenburg",
		"Sachsen-Anhalt",
		"Thüringen",
	];

	for (const stateName of eastGermanStates) {
		console.log(`  Publishing ${stateName}...`);
		const geoEventData = await generateGeoEventData(undefined, {
			useRealData: true,
			stateName: stateName,
		});
		await createGeoEventEvent(signer, ndk, geoEventData);
	}

	console.log("Seeding complete!");
	process.exit(0);
}

seedData().catch((error) => {
	console.error("Seeding failed:", error);
	process.exit(1);
});
