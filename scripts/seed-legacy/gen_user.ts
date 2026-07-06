import { faker } from "@faker-js/faker";
import type NDK from "@/lib/seed-relay";
import { NDKEvent, type NDKPrivateKeySigner, type NDKUserProfile } from "@/lib/seed-relay";

const WALLETED_USER_LUD16 = "schlauskwab@minibits.cash";

/**
 * Generates random user profile data, optionally with user index for consistent profiles
 * @param userIndex Optional user index to create a more consistent profile across runs
 * @returns A randomly generated user profile
 */
export function generateUserProfileData(userIndex?: number): NDKUserProfile {
  // Use seed if user index is provided to generate consistent profiles
  if (userIndex !== undefined) {
    faker.seed(userIndex + 1000); // Add offset to avoid potential seed conflicts
  }

  // Create a base username that will be used for multiple fields
  const baseUsername = faker.internet.username().toLowerCase();

  // Categories for different banner images
  const bannerCategories = [
    "abstract",
    "nature",
    "technology",
    "business",
    "city",
  ];
  const selectedCategory =
    userIndex !== undefined
      ? bannerCategories[userIndex % bannerCategories.length]
      : faker.helpers.arrayElement(bannerCategories);

  // Generate a profile with more consistent usernames across fields
  return {
    name: baseUsername,
    displayName: faker.person.fullName(),
    image: faker.image.avatarGitHub(), // GitHub avatars are good placeholders
    banner: faker.image.urlLoremFlickr({
      category: selectedCategory,
      width: 1200,
      height: 400,
    }),
    about: faker.lorem.paragraph(3),
    nip05: `${baseUsername}@example.com`,
    website: `https://${baseUsername}.com`,
    lud06: faker.finance.bitcoinAddress(),
    lud16: WALLETED_USER_LUD16,
  };
}

/**
 * Creates and publishes a user profile (kind 0) event for the given signer.
 *
 * @param signer Private-key signer that owns the profile.
 * @param ndk NDK shim instance whose `explicitRelayUrls` we publish to.
 * @param profileData Plain object that will be JSON-encoded into the event content.
 * @returns Boolean indicating success or failure.
 */
export async function createUserProfileEvent(
  signer: NDKPrivateKeySigner,
  ndk: NDK,
  profileData: NDKUserProfile,
): Promise<boolean> {
  try {
    const event = new NDKEvent(ndk);
    event.kind = 0;
    event.content = JSON.stringify(profileData);
    event.tags = [];
    await event.sign(signer);
    await event.publish();

    console.log(`Published profile for ${profileData.name}`);
    return true;
  } catch (error) {
    console.error("Failed to publish user profile", error);
    return false;
  }
}
